/**
 * M17 (theokit-ai-first) — ACP client: JSON-RPC over the stdio framing.
 *
 * Drives a coding agent (Claude Code, Amp, Codex) over an INJECTED {@link AcpTransport}. The
 * subprocess spawn is a Node API and lives in the adapter layer (G8); this client is transport-
 * agnostic and testable. It correlates responses to requests by `id`, dispatches server→client
 * requests (e.g. `session/request_permission`) to a registered handler, replying with its decision,
 * and delivers notifications (a `method` with no `id`, e.g. `session/update`) to their handler.
 */
import { TheokitAgentError } from '@theokit/sdk/errors'

import { encodeAcpMessage } from './protocol.js'

/** The stdio channel to the coding-agent subprocess (abstracted for testability + G8). */
export interface AcpTransport {
  /** Write one already-encoded (newline-terminated) line to the agent's stdin. */
  send(line: string): void
  /** Subscribe to raw lines/chunks from the agent's stdout. */
  subscribe(onData: (chunk: string) => void): void
  /**
   * Report a channel that closed on its own (the process exited or failed). Optional: a transport
   * that has it lets the client reject the requests no reply will ever answer.
   */
  onClose?(listener: (cause: Error) => void): void
}

/**
 * The agent wrote a stdout line that does not decode to a JSON-RPC message: it is not JSON, it is
 * JSON but not an object (`null`, a number, a string, an array), or it is an object that is not a
 * response, a request or a notification. `line` is the line, trimmed. Code `ACP_PROTOCOL_ERROR`.
 */
export class AcpProtocolError extends TheokitAgentError {
  override readonly name = 'AcpProtocolError'

  constructor(
    readonly line: string,
    options?: { cause?: unknown },
  ) {
    super(`[@theokit/agents] ACP decode failed on line: ${line}`, {
      ...options,
      code: 'ACP_PROTOCOL_ERROR',
      isRetryable: false,
    })
  }
}

/** The transport closed; `cause` is what the transport reported. Code `ACP_CONNECTION_CLOSED`. */
export class AcpConnectionClosedError extends TheokitAgentError {
  override readonly name = 'AcpConnectionClosedError'

  constructor(cause: Error) {
    super(`[@theokit/agents] ACP transport closed: ${cause.message}`, {
      cause,
      code: 'ACP_CONNECTION_CLOSED',
      isRetryable: false,
    })
  }
}

interface JsonRpcResponse {
  id: number
  result?: unknown
  error?: { code: number; message: string }
}
interface JsonRpcServerRequest {
  id: number
  method: string
  params?: unknown
}

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}
/** Return a value or a Promise — `unknown` already includes `Promise<unknown>`; `await` handles both. */
type ServerRequestHandler = (params: unknown) => unknown
/** Called with a notification's `params`; nothing is sent back. A returned promise is watched. */
type NotificationHandler = (params: unknown) => void | Promise<void>

function isResponse(m: Record<string, unknown>): m is JsonRpcResponse & Record<string, unknown> {
  return typeof m.id === 'number' && ('result' in m || 'error' in m) && !('method' in m)
}
function isServerRequest(
  m: Record<string, unknown>,
): m is JsonRpcServerRequest & Record<string, unknown> {
  return typeof m.method === 'string' && typeof m.id === 'number'
}
function isNotification(
  m: Record<string, unknown>,
): m is { method: string; params?: unknown } & Record<string, unknown> {
  return typeof m.method === 'string' && !('id' in m)
}

export class AcpClient {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly handlers = new Map<string, ServerRequestHandler>()
  private readonly notificationHandlers = new Map<string, NotificationHandler>()
  private buffer = ''
  private closed: AcpConnectionClosedError | undefined

  constructor(private readonly transport: AcpTransport) {
    // The agent's stdout is untrusted, and the Node transport calls this from a `data` listener,
    // where a throw ends the host. Each line is handled on its own: a bad one fails the requests in
    // flight when it arrives, and the well-formed lines around it are still dispatched. `buffer`
    // carries a partial trailing line to the next chunk. A transport that reports its own close
    // fails every pending request, and every later one, with the same typed error.
    transport.subscribe((chunk) => {
      const lines = (this.buffer + chunk).split('\n')
      this.buffer = lines.pop() ?? ''
      for (const line of lines) this.receive(line.trim())
    })
    transport.onClose?.((cause) => {
      this.closed ??= new AcpConnectionClosedError(cause)
      this.fail(this.closed)
    })
  }

  /** Send a JSON-RPC request and resolve with its `result` (or reject on `error`). */
  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      if (this.closed) throw this.closed
      this.pending.set(id, { resolve, reject })
      this.transport.send(encodeAcpMessage({ jsonrpc: '2.0', id, method, params }))
    })
  }

  /** Register a handler for a server→client request method (e.g. `session/request_permission`). */
  onRequest(method: string, handler: ServerRequestHandler): void {
    this.handlers.set(method, handler)
  }

  /** Register a notification handler; one that throws or rejects is reported. */
  onNotification(method: string, handler: NotificationHandler): void {
    this.notificationHandlers.set(method, handler)
  }

  private receive(line: string): void {
    if (!line) return
    let message: unknown, cause: unknown
    try {
      message = JSON.parse(line)
    } catch (err) {
      cause = err
    }
    if (message instanceof Object && !Array.isArray(message)) {
      this.dispatch(message as Record<string, unknown>, line)
    } else {
      // Not JSON, or JSON that is not an object: both fail the requests in flight, or are reported.
      this.fail(new AcpProtocolError(line, { cause }))
    }
  }

  private fail(err: Error): void {
    if (!this.pending.size) console.warn(err)
    for (const entry of this.pending.values()) entry.reject(err)
    this.pending.clear()
  }

  private dispatch(message: Record<string, unknown>, line: string): void {
    if (isResponse(message)) {
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
      return
    }
    if (isServerRequest(message)) {
      void this.handleServerRequest(message)
      return
    }
    if (isNotification(message)) void this.notify(message)
    // An object of no JSON-RPC shape answers nothing: fail what it was meant to answer.
    else this.fail(new AcpProtocolError(line))
  }

  private async notify(m: { method: string; params?: unknown }): Promise<void> {
    // Async so a handler that throws and one whose promise rejects are both caught here; the
    // handler is still called synchronously, before the next line of the chunk is dispatched.
    try {
      await this.notificationHandlers.get(m.method)?.(m.params)
    } catch (err) {
      console.warn('[@theokit/agents] ACP notification handler threw', err)
    }
  }

  private async handleServerRequest(req: JsonRpcServerRequest): Promise<void> {
    const handler = this.handlers.get(req.method)
    let reply: { result: unknown } | { error: { code: number; message: string } } = {
      error: { code: -32601, message: `No handler: ${req.method}` },
    }
    if (handler) {
      try {
        reply = { result: await handler(req.params) }
      } catch (err) {
        reply = {
          error: { code: -32603, message: err instanceof Error ? err.message : 'handler failed' },
        }
      }
    }
    this.transport.send(encodeAcpMessage({ jsonrpc: '2.0', id: req.id, ...reply }))
  }
}
