/**
 * M17 (theokit-ai-first) — ACP client: JSON-RPC over the stdio framing.
 *
 * Drives a coding agent (Claude Code, Amp, Codex) over an INJECTED {@link AcpTransport}. The
 * subprocess spawn is a Node API and lives in the adapter layer (G8); this client is transport-
 * agnostic and testable. It correlates responses to requests by `id`, and dispatches server→client
 * requests (e.g. `session/request_permission`) to a registered handler, replying with its decision.
 */
import { AcpMessageDecoder, encodeAcpMessage } from './protocol.js'

/** The stdio channel to the coding-agent subprocess (abstracted for testability + G8). */
export interface AcpTransport {
  /** Write one already-encoded (newline-terminated) line to the agent's stdin. */
  send(line: string): void
  /** Subscribe to raw lines/chunks from the agent's stdout. */
  subscribe(onData: (chunk: string) => void): void
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

function isResponse(m: Record<string, unknown>): m is JsonRpcResponse & Record<string, unknown> {
  return typeof m.id === 'number' && (('result' in m) || ('error' in m)) && !('method' in m)
}
function isServerRequest(m: Record<string, unknown>): m is JsonRpcServerRequest & Record<string, unknown> {
  return typeof m.method === 'string' && typeof m.id === 'number'
}

export class AcpClient {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly handlers = new Map<string, ServerRequestHandler>()
  private readonly decoder = new AcpMessageDecoder()

  constructor(private readonly transport: AcpTransport) {
    transport.subscribe((chunk) => {
      for (const message of this.decoder.push(chunk)) {
        this.dispatch(message as Record<string, unknown>)
      }
    })
  }

  /** Send a JSON-RPC request and resolve with its `result` (or reject on `error`). */
  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.transport.send(encodeAcpMessage({ jsonrpc: '2.0', id, method, params }))
    })
  }

  /** Register a handler for a server→client request method (e.g. `session/request_permission`). */
  onRequest(method: string, handler: ServerRequestHandler): void {
    this.handlers.set(method, handler)
  }

  private dispatch(message: Record<string, unknown>): void {
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
    }
  }

  private async handleServerRequest(req: JsonRpcServerRequest): Promise<void> {
    const handler = this.handlers.get(req.method)
    if (!handler) {
      this.transport.send(
        encodeAcpMessage({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `No handler: ${req.method}` } }),
      )
      return
    }
    try {
      const result = await handler(req.params)
      this.transport.send(encodeAcpMessage({ jsonrpc: '2.0', id: req.id, result }))
    } catch (err) {
      this.transport.send(
        encodeAcpMessage({
          jsonrpc: '2.0',
          id: req.id,
          error: { code: -32603, message: err instanceof Error ? err.message : 'handler failed' },
        }),
      )
    }
  }
}
