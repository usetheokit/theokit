/**
 * M17 (theokit-ai-first) — createACPTool: wrap a coding agent (Claude Code, Amp, Codex) as a tool.
 *
 * Spawns the agent as a subprocess (Node `child_process` — an adapter concern per G8), drives it
 * with the transport-agnostic {@link AcpClient} over newline-delimited JSON-RPC, and returns a
 * `CustomTool`. Each call runs the ACP handshake: `initialize`, then `session/new`, then
 * `session/prompt` naming the session it got back. The agent streams its reply as `session/update`
 * notifications, so the call returns the text of the `agent_message_chunk` updates for its session.
 * `onPermissionRequest` is REQUIRED — security by default (no default-allow for file/shell
 * operations); its decision is answered as an ACP permission outcome. The transport is injectable
 * for tests.
 *
 * Each call owns its transport: it is closed when the call ends, on a reply, a refusal or an
 * error, and the call waits for the process to exit, so no agent process outlives the call that
 * spawned it. Closing asks with SIGTERM and, past a grace period, ends the process with SIGKILL. On
 * Linux and macOS the agent runs in its own process group and closing signals the whole group, so
 * an agent started through a launcher (`npx`, a shell script) ends with the launcher. A
 * process that cannot start or exits mid-turn rejects the call with {@link AcpTransportClosedError};
 * a stdout line that is not a JSON-RPC message rejects it with the client's `AcpProtocolError`,
 * naming the line; a request the agent does not answer within `timeoutMs` rejects it with
 * {@link AcpRequestTimeoutError}. A cancelled run (the `signal` the SDK
 * passes as the handler's context) rejects the call with the signal's abort reason and closes the
 * agent the same way; a run already cancelled starts no agent.
 */
import { resolve } from 'node:path'

import { AcpClient, AcpConnectionClosedError, AcpProtocolError } from '@theokit/agents'
import type { CustomTool, ToolContext } from '@theokit/sdk'

import {
  AcpTransportClosedError,
  type AcpToolTransport,
  NodeAcpTransport,
} from './node-acp-transport.js'

// The process transport lives in its own module; its public names stay reachable from here.
export { AcpTransportClosedError, NodeAcpTransport }
export type { AcpToolTransport }

/** The agent did not answer one request of the turn within the configured timeout. */
export class AcpRequestTimeoutError extends Error {
  override readonly name = 'AcpRequestTimeoutError'

  constructor(
    /** The agent executable, as configured. */
    readonly command: string,
    /** The ACP method left unanswered, e.g. `session/prompt`. */
    readonly method: string,
    /** The timeout that elapsed, in milliseconds. */
    readonly timeoutMs: number,
  ) {
    super(
      `[theokit] createACPTool: the agent "${command}" did not answer ${method} within ${String(timeoutMs)}ms`,
    )
  }
}

export interface AcpToolConfig {
  /** Executable for the coding agent (e.g. `claude`, `amp`, `codex`). */
  command: string
  /** Command-line arguments. */
  args?: string[]
  /** Working directory for the spawned agent. */
  cwd?: string
  /** Tool name the model calls. */
  name: string
  /** Tool description surfaced to the model. */
  description: string
  /**
   * REQUIRED — decide file/shell permission requests from the coding agent. Security by default:
   * there is NO default-allow. Return `{ granted: boolean }` (may be async).
   */
  onPermissionRequest: (params: unknown) => { granted: boolean } | Promise<{ granted: boolean }>
  /**
   * How long one request of the turn (`initialize`, `session/new`, `session/prompt`) may wait for
   * the agent's answer, in milliseconds. Defaults to {@link DEFAULT_ACP_TIMEOUT_MS}. A request
   * past it rejects the call with {@link AcpRequestTimeoutError} and the agent process is closed.
   */
  timeoutMs?: number
  /** Injected transport factory (defaults to spawning via {@link NodeAcpTransport}) — for tests. */
  transportFactory?: (config: AcpToolConfig) => AcpToolTransport
}

/** Default per-request timeout: ten minutes, room for a long coding turn without hanging forever. */
export const DEFAULT_ACP_TIMEOUT_MS = 600_000

function defaultTransport(config: AcpToolConfig): AcpToolTransport {
  return new NodeAcpTransport(config.command, config.args, config.cwd)
}

/** The ACP protocol version this client speaks. */
const ACP_PROTOCOL_VERSION = 1

type AcpPermissionResponse =
  | { outcome: { outcome: 'selected'; optionId: string } }
  | { outcome: { outcome: 'cancelled' } }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Translate the callback's decision into an ACP `RequestPermissionResponse`. The option is chosen
 * by `kind`: a grant selects `allow_once` (never `allow_always`, which grants more than was
 * approved); a denial selects `reject_once`, else `reject_always`. No option of the needed kind
 * answers `cancelled`, which an agent treats as a veto.
 */
function toAcpPermissionResponse(
  params: unknown,
  decision: { granted: boolean },
): AcpPermissionResponse {
  const options = isRecord(params) && Array.isArray(params.options) ? params.options : []
  const wanted = decision.granted ? ['allow_once'] : ['reject_once', 'reject_always']
  for (const kind of wanted) {
    const option: unknown = options.find((o) => isRecord(o) && o.kind === kind)
    if (isRecord(option) && typeof option.optionId === 'string') {
      return { outcome: { outcome: 'selected', optionId: option.optionId } }
    }
  }
  return { outcome: { outcome: 'cancelled' } }
}

/** The text of an `agent_message_chunk` update for `sessionId`, or `undefined` for anything else. */
function agentTextChunk(params: unknown, sessionId: string): string | undefined {
  if (!isRecord(params) || params.sessionId !== sessionId || !isRecord(params.update))
    return undefined
  const { sessionUpdate, content } = params.update
  if (sessionUpdate !== 'agent_message_chunk' || !isRecord(content)) return undefined
  return content.type === 'text' && typeof content.text === 'string' ? content.text : undefined
}

/** What one turn needs besides the client: who to name in errors, and how long to wait. */
interface Turn {
  client: AcpClient
  command: string
  timeoutMs: number
  /** The run's signal; once it aborts, no further step is sent. */
  signal?: AbortSignal
  /** Rejects the step in flight, so a run that is cancelled ends it. */
  abort?: (reason: unknown) => void
}

/**
 * What a rejection of `AcpClient.request` means for the call. A channel that closed rejects with
 * the error its transport reported, and a protocol break with the client's `AcpProtocolError`,
 * whatever the transport: neither is the agent's answer. Only a JSON-RPC error answer is a refusal,
 * which rejects with an error naming the method and keeping the agent's error as `cause`.
 */
function stepFailure(method: string, cause: unknown): Error {
  if (cause instanceof AcpConnectionClosedError) {
    return cause.cause instanceof Error ? cause.cause : cause
  }
  if (cause instanceof AcpProtocolError) return cause
  const reason = cause instanceof Error ? cause.message : String(cause)
  return new Error(`[theokit] createACPTool: the agent refused ${method}: ${reason}`, { cause })
}

/**
 * Send one step of the turn. A refusal rejects with an error naming the method (see
 * {@link stepFailure}), so the caller learns which step failed and nothing later is sent. A closed
 * transport, a protocol break, an elapsed timeout or a cancelled run rejects with its own error.
 */
async function step(turn: Turn, method: string, params: unknown): Promise<unknown> {
  turn.signal?.throwIfAborted()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await new Promise<unknown>((resolve, reject) => {
      turn.abort = reject
      timer = setTimeout(() => {
        reject(new AcpRequestTimeoutError(turn.command, method, turn.timeoutMs))
      }, turn.timeoutMs)
      turn.client
        .request(method, params)
        .then(resolve)
        .catch((cause: unknown) => {
          reject(stepFailure(method, cause))
        })
    })
  } finally {
    clearTimeout(timer)
    turn.abort = undefined
  }
}

/** The `sessionId` a `session/new` result carries; a result without one is a refusal. */
function sessionIdOf(created: unknown): string {
  if (isRecord(created) && typeof created.sessionId === 'string') return created.sessionId
  throw new Error(
    `[theokit] createACPTool: the agent refused session/new: returned no sessionId (got ${JSON.stringify(created)})`,
  )
}

/**
 * Run one ACP turn: handshake, prompt, and the reply text streamed for the session. Updates are
 * buffered as they arrive (before `session/prompt` resolves) and filtered by the session after.
 */
async function runTurn(turn: Turn, cwd: string, message: string): Promise<string> {
  const updates: unknown[] = []
  turn.client.onNotification('session/update', (params) => {
    updates.push(params)
  })
  await step(turn, 'initialize', {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: {},
  })
  const sessionId = sessionIdOf(await step(turn, 'session/new', { cwd, mcpServers: [] }))
  await step(turn, 'session/prompt', { sessionId, prompt: [{ type: 'text', text: message }] })
  const texts = updates.map((params) => agentTextChunk(params, sessionId))
  return texts.filter((text): text is string => text !== undefined).join('')
}

/** Wrap a coding agent as a `CustomTool`. Fails fast if `onPermissionRequest` is missing. */
export function createACPTool(config: AcpToolConfig): CustomTool {
  if (typeof config.onPermissionRequest !== 'function') {
    throw new Error(
      '[theokit] createACPTool requires onPermissionRequest (security by default — no default-allow)',
    )
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_ACP_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      `[theokit] createACPTool: timeoutMs must be a positive finite number of milliseconds (got ${String(timeoutMs)})`,
    )
  }
  const makeTransport = config.transportFactory ?? defaultTransport
  return {
    name: config.name,
    description: config.description,
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'The task/prompt for the coding agent.' },
      },
      required: ['message'],
    },
    handler: async (input: Record<string, unknown>, ctx?: ToolContext): Promise<string> => {
      const message = typeof input.message === 'string' ? input.message : ''
      const signal = ctx?.signal
      // A run cancelled before the call starts gets no agent at all.
      signal?.throwIfAborted()
      const transport = makeTransport(config)
      let onAbort: (() => void) | undefined
      try {
        const turn: Turn = {
          client: new AcpClient(transport),
          command: config.command,
          timeoutMs,
          signal,
        }
        // A cancelled run rejects the step in flight with the abort reason; the finally below then
        // closes the agent, so a cancellation does not wait for the request timeout.
        onAbort = () => turn.abort?.(signal?.reason)
        signal?.addEventListener('abort', onAbort, { once: true })
        turn.client.onRequest('session/request_permission', async (params) =>
          toAcpPermissionResponse(params, await config.onPermissionRequest(params)),
        )
        return await runTurn(turn, resolve(config.cwd ?? process.cwd()), message)
      } finally {
        if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort)
        // The agent is a long-lived stdio server: left open, every call would leave one running.
        // Awaited, so the call does not return while its agent is still running.
        await transport.close?.()
      }
    },
  }
}

// M56: the `encodeAcpMessage` re-export had no consumer — callers building custom transports
// import it from `@theokit/agents` directly, which is where it is defined.
