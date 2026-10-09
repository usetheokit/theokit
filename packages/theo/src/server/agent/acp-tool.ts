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
 * process that cannot start, exits mid-turn or writes something that is not ACP JSON-RPC on stdout
 * rejects the call with {@link AcpTransportClosedError}; a request the agent does not answer within
 * `timeoutMs` rejects it with {@link AcpRequestTimeoutError}. A cancelled run (the `signal` the SDK
 * passes as the handler's context) rejects the call with the signal's abort reason and closes the
 * agent the same way; a run already cancelled starts no agent.
 */
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { resolve } from 'node:path'
import type { Readable, Writable } from 'node:stream'

import {
  AcpClient,
  AcpConnectionClosedError,
  AcpMessageDecoder,
  AcpProtocolError,
  type AcpTransport,
} from '@theokit/agents'
import type { CustomTool, ToolContext } from '@theokit/sdk'

/**
 * Whether `m` is one of the JSON-RPC shapes `AcpClient` dispatches: a response (numeric `id` with
 * `result` or `error`, no `method`), a request (`method` and numeric `id`) or a notification
 * (`method`, no `id`). The client keeps these predicates private, so the rule is restated here.
 */
function isJsonRpcMessage(m: unknown): boolean {
  if (!(m instanceof Object) || Array.isArray(m)) return false
  const { id, method } = m as Record<string, unknown>
  if (typeof method === 'string') return typeof id === 'number' || !('id' in m)
  return !('method' in m) && typeof id === 'number' && ('result' in m || 'error' in m)
}

/** The agent process could not start, failed, or exited before the call finished. */
export class AcpTransportClosedError extends Error {
  override readonly name = 'AcpTransportClosedError'

  constructor(
    /** The agent executable, as configured. */
    readonly command: string,
    /** What happened to the process, e.g. `exited with code 3` or `failed: spawn x ENOENT`. */
    readonly reason: string,
    options?: { cause?: unknown },
  ) {
    super(`[theokit] createACPTool: the agent process "${command}" ${reason}`, options)
  }
}

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

/**
 * A transport {@link createACPTool} can release. `close` is called once when the call ends, and the
 * call waits for it when it returns a promise. `onClose`, inherited from {@link AcpTransport},
 * reports a channel that closed on its own (the process failed or exited), which rejects the request
 * in flight with the error it reports: {@link NodeAcpTransport} reports an
 * {@link AcpTransportClosedError}. Both are optional so a plain {@link AcpTransport} still works.
 */
export interface AcpToolTransport extends AcpTransport {
  close?(): void | Promise<void>
}

/** How long {@link NodeAcpTransport.close} waits after SIGTERM before it sends SIGKILL. */
const SIGTERM_GRACE_MS = 2_000
/** How long it waits for the exit SIGKILL causes; the signal cannot be ignored, so this is a bound. */
const SIGKILL_WAIT_MS = 2_000
/** How often {@link NodeAcpTransport.close} checks whether the agent's process group is gone. */
const GROUP_POLL_MS = 20

/**
 * Whether the agent gets its own process group. A launcher (`npx`, a shell script) runs the agent
 * as its child, so signalling only the pid the transport spawned ends the launcher and leaves the
 * agent running; signalling the group ends both. Windows has no process groups to signal this way:
 * there the transport signals the spawned process alone, as it always did, and an agent behind a
 * launcher can outlive the call.
 */
const OWN_PROCESS_GROUP = process.platform !== 'win32'

/** Stdio transport backed by a spawned subprocess (the default for {@link createACPTool}). */
export class NodeAcpTransport implements AcpToolTransport {
  // stdin=pipe, stdout=pipe, stderr=inherit → the third stream is null.
  private readonly proc: ChildProcessByStdio<Writable, Readable, null>
  private closed: AcpTransportClosedError | undefined
  private readonly listeners: ((error: AcpTransportClosedError) => void)[] = []
  /** Set once the agent wrote something the client could not process; later output is dropped. */
  private broke = false
  /** Settles when the process has exited (or never started). */
  private readonly exited: Promise<void>

  constructor(
    private readonly command: string,
    args: string[] = [],
    cwd?: string,
  ) {
    // `detached` makes the agent the leader of a new process group (POSIX), the group close signals.
    this.proc = spawn(command, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'inherit'],
      detached: OWN_PROCESS_GROUP,
    })
    // A pipe cuts stdout wherever it likes; a streaming decoder carries a multibyte character split
    // across two chunks instead of turning each half into U+FFFD.
    this.proc.stdout.setEncoding('utf8')
    // 'exit', not 'close': a grandchild holding stdout open delays 'close' but not the exit.
    this.exited = new Promise((resolve) => {
      this.proc.once('exit', () => {
        resolve()
      })
    })
    // Without an 'error' listener a spawn failure (ENOENT) is thrown as an uncaught exception that
    // takes the host down; stdin raises EPIPE when the process is gone. Both end the channel.
    this.proc.on('error', (err) => {
      this.end(`failed: ${err.message}`, err)
    })
    this.proc.stdin.on('error', (err) => {
      this.end(`closed its stdin: ${err.message}`, err)
    })
    // 'close', not 'exit': it fires after stdout is drained, so a reply written just before the
    // process exits is still delivered.
    this.proc.on('close', (code, signal) => {
      this.end(code === null ? `exited on signal ${String(signal)}` : `exited with code ${code}`)
    })
  }

  send(line: string): void {
    if (this.closed === undefined) this.proc.stdin.write(line)
  }

  subscribe(onData: (chunk: string) => void): void {
    // The agent's stdout is untrusted. A line that is not JSON (a banner, a log line), or JSON that
    // is not a JSON-RPC message the client dispatches (`42`, an id with no result), breaks the
    // protocol: it is caught here, before the client sees it, and it ends this channel so the call
    // in flight rejects typed. A throw from the client itself ends it the same way; escaping this
    // listener it would be an uncaught exception in the host.
    const probe = new AcpMessageDecoder()
    this.proc.stdout.on('data', (chunk: string) => {
      if (this.broke) return
      try {
        for (const message of probe.push(chunk)) {
          if (!isJsonRpcMessage(message)) {
            throw new Error(`not a JSON-RPC message: ${JSON.stringify(message)}`)
          }
        }
        onData(chunk)
      } catch (err) {
        this.broke = true
        this.end(`broke the ACP protocol: ${err instanceof Error ? err.message : String(err)}`, err)
      }
    })
  }

  onClose(listener: (error: AcpTransportClosedError) => void): void {
    if (this.closed !== undefined) listener(this.closed)
    else this.listeners.push(listener)
  }

  /**
   * End the channel and the process, and settle once the process and its group have exited:
   * SIGTERM first, then SIGKILL for anything still running after {@link SIGTERM_GRACE_MS}.
   */
  async close(): Promise<void> {
    this.end('was closed by the caller')
    try {
      if (!this.running() && !this.groupAlive()) return
      this.signal('SIGTERM')
      if (await this.goneWithin(SIGTERM_GRACE_MS)) return
      this.signal('SIGKILL')
      await this.goneWithin(SIGKILL_WAIT_MS)
    } finally {
      // Nothing is read or written after close; a process that escaped its group and still holds
      // the pipes must not keep the host's event loop alive.
      this.proc.stdin.destroy()
      this.proc.stdout.destroy()
      this.proc.unref()
    }
  }

  /** Whether the process started and has not exited yet. */
  private running(): boolean {
    return (
      this.proc.pid !== undefined && this.proc.exitCode === null && this.proc.signalCode === null
    )
  }

  /** Whether a process of the agent's group is still running (always `false` without a group). */
  private groupAlive(): boolean {
    const pid = this.proc.pid
    if (!OWN_PROCESS_GROUP || pid === undefined) return false
    try {
      process.kill(-pid, 0)
      return true
    } catch (err) {
      // ESRCH: no process is left in the group. EPERM: one is, and it is not ours to signal.
      return (err as NodeJS.ErrnoException).code === 'EPERM'
    }
  }

  /** Send `signal` to the agent's process group, or to the spawned process without one. */
  private signal(signal: NodeJS.Signals): void {
    const pid = this.proc.pid
    if (!OWN_PROCESS_GROUP || pid === undefined) {
      this.proc.kill(signal)
      return
    }
    try {
      process.kill(-pid, signal)
    } catch (err) {
      // The group emptied between the check and the signal: there is nothing left to end.
      if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err
    }
  }

  /** Wait up to `ms` for the process and every process of its group to exit; `true` when they did. */
  private async goneWithin(ms: number): Promise<boolean> {
    const deadline = Date.now() + ms
    if (!(await this.exitsWithin(ms))) return false
    while (this.groupAlive()) {
      if (Date.now() >= deadline) return false
      await new Promise((resolve) => setTimeout(resolve, GROUP_POLL_MS))
    }
    return true
  }

  /** Wait up to `ms` for the process to exit; `true` when it did. */
  private async exitsWithin(ms: number): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const elapsed = new Promise<false>((resolve) => {
      timer = setTimeout(() => {
        resolve(false)
      }, ms)
    })
    try {
      return await Promise.race([this.exited.then(() => true as const), elapsed])
    } finally {
      clearTimeout(timer)
    }
  }

  /** Record the first way the channel ended and tell every listener; later endings are ignored. */
  private end(reason: string, cause?: unknown): void {
    if (this.closed !== undefined) return
    const error = new AcpTransportClosedError(this.command, reason, { cause })
    this.closed = error
    for (const listener of this.listeners.splice(0)) listener(error)
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
