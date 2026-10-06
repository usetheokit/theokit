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
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'

import { AcpClient, type AcpTransport } from '@theokit/agents'
import type { CustomTool } from '@theokit/sdk'

/** Stdio transport backed by a spawned subprocess (the default for {@link createACPTool}). */
export class NodeAcpTransport implements AcpTransport {
  // stdin=pipe, stdout=pipe, stderr=inherit → the third stream is null.
  private readonly proc: ChildProcessByStdio<Writable, Readable, null>

  constructor(command: string, args: string[] = [], cwd?: string) {
    this.proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'inherit'] })
  }

  send(line: string): void {
    this.proc.stdin.write(line)
  }

  subscribe(onData: (chunk: string) => void): void {
    this.proc.stdout.on('data', (buf: Buffer) => {
      onData(buf.toString('utf8'))
    })
  }

  close(): void {
    this.proc.kill()
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
  /** Injected transport factory (defaults to spawning via {@link NodeAcpTransport}) — for tests. */
  transportFactory?: (config: AcpToolConfig) => AcpTransport
}

function defaultTransport(config: AcpToolConfig): AcpTransport {
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

/**
 * Send one step of the turn. A refusal rejects with an error naming the method, keeping the
 * agent's error as `cause`, so the caller learns which step failed and nothing later is sent.
 */
async function step(client: AcpClient, method: string, params: unknown): Promise<unknown> {
  try {
    return await client.request(method, params)
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`[theokit] createACPTool: the agent refused ${method}: ${reason}`, { cause })
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
async function runTurn(client: AcpClient, cwd: string, message: string): Promise<string> {
  const updates: unknown[] = []
  client.onNotification('session/update', (params) => {
    updates.push(params)
  })
  await step(client, 'initialize', {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: {},
  })
  const sessionId = sessionIdOf(await step(client, 'session/new', { cwd, mcpServers: [] }))
  await step(client, 'session/prompt', { sessionId, prompt: [{ type: 'text', text: message }] })
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
    handler: async (input: Record<string, unknown>): Promise<string> => {
      const message = typeof input.message === 'string' ? input.message : ''
      const client = new AcpClient(makeTransport(config))
      client.onRequest('session/request_permission', async (params) =>
        toAcpPermissionResponse(params, await config.onPermissionRequest(params)),
      )
      return runTurn(client, resolve(config.cwd ?? process.cwd()), message)
    },
  }
}

// M56: the `encodeAcpMessage` re-export had no consumer — callers building custom transports
// import it from `@theokit/agents` directly, which is where it is defined.
