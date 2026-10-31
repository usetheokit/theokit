import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'

import { nodeIncomingToRequest, writeResponseToNode } from '@theokit/http/runtime/node'

import { attachControlSocket, type ControlSocket, type ControlSocketOptions } from './control-socket.js'
import { describeError, TheoClawBindError } from './errors.js'

export type RequestHandler = (request: Request) => Promise<Response>

export interface ListenOptions {
  readonly handler: RequestHandler
  readonly port: number
  readonly host: string
  /** The `/control` socket. Without it every upgrade is refused 404. */
  readonly control?: ControlSocketOptions
  /** Where a failed request is written, one line per call. */
  readonly stderr: (line: string) => void
}

export interface ControlPlaneHandle {
  /** The address read from the bound socket, never from the configuration (FR-004). */
  address(): { readonly host: string; readonly port: number }
  /** Close every open connection, then the server; resolves once both are closed. */
  close(): Promise<void>
  readonly server: Server
}

/** `GET /health` answers 200 `{"status":"ok"}`; every other method or path answers 404. */
export async function healthHandler(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (request.method === 'GET' && pathname === '/health') return Response.json({ status: 'ok' })
  return new Response(null, { status: 404 })
}

/**
 * Refuse an upgrade on a raw socket: write the status line, then destroy once it is flushed. A
 * client that resets mid-refusal emits `error` on the socket; unheard, it would end the process.
 */
export function refuseUpgrade(
  socket: Duplex,
  status: '401 Unauthorized' | '404 Not Found',
  stderr: (line: string) => void,
): void {
  socket.on('error', (error) => stderr(`theoclaw: upgrade socket error: ${describeError(error)}`))
  socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`)
  socket.once('finish', () => socket.destroy())
}

/**
 * The request with a signal that aborts when its response closes before it finished: the client
 * left. Neither `nodeIncomingToRequest` nor `writeResponseToNode` says so, and the app owns its
 * server, so the signal is attached here rather than in `@theokit/http` (plan D3). The listener is
 * registered before the handler runs, so a client that leaves while the handler awaits is seen too;
 * a finished response emits `close` after `finish`, which `writableFinished` keeps from aborting.
 */
function withDepartureSignal(incoming: IncomingMessage, outgoing: ServerResponse): Request {
  const controller = new AbortController()
  outgoing.once('close', () => {
    if (!outgoing.writableFinished) controller.abort()
  })
  return new Request(nodeIncomingToRequest(incoming), { signal: controller.signal })
}

/**
 * The adapt, handle and write sequence in one `try`: `nodeIncomingToRequest` throws on a malformed
 * `Host`, `writeResponseToNode` catches nothing, and a handler can throw. Each answers 500 and the
 * reason goes to stderr (no request body, which may carry a secret).
 */
function serve(options: ListenOptions) {
  return (incoming: IncomingMessage, outgoing: ServerResponse): void => {
    void (async () => {
      try {
        await writeResponseToNode(await options.handler(withDepartureSignal(incoming, outgoing)), outgoing)
      } catch (error) {
        options.stderr(`theoclaw: request failed: ${describeError(error)}`)
        if (!outgoing.headersSent) outgoing.writeHead(500)
        outgoing.end()
      }
    })()
  }
}

/** Map a failing `listen` to the typed refusal: a busy port names the port, a foreign address the address. */
function bindFailure(error: NodeJS.ErrnoException, options: ListenOptions): Error {
  if (error.code === 'EADDRINUSE') {
    return new TheoClawBindError(`port ${options.port} on ${options.host} is already in use`, {
      address: options.host,
      port: options.port,
    })
  }
  if (error.code === 'EADDRNOTAVAIL') {
    return new TheoClawBindError(`address ${options.host} is not available on this host`, {
      address: options.host,
      port: options.port,
    })
  }
  return error
}

function listen(server: Server, options: ListenOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException): void => reject(bindFailure(error, options))
    server.once('error', onError)
    server.listen(options.port, options.host, () => {
      server.off('error', onError)
      resolve()
    })
  })
}

function handleFor(
  server: Server,
  control: ControlSocket | undefined,
  sessions: ControlSocketOptions['sessions'],
): ControlPlaneHandle {
  let closing: Promise<void> | undefined
  return {
    server,
    address: () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        throw new Error('the control plane is not listening on a TCP address')
      }
      return { host: address.address, port: address.port }
    },
    // Memoized: a second call waits for the first close instead of failing ERR_SERVER_NOT_RUNNING.
    close: () =>
      (closing ??= (async () => {
        // An upgraded socket leaves the HTTP parser's list, so `closeAllConnections` never reaches
        // it and `server.close` would wait on it forever (EC-3): the control clients end first.
        try {
          await control?.close()
        } finally {
          try {
            // The session agents outlive their turns, so they go with the control plane.
            await sessions?.close()
          } finally {
            await new Promise<void>((resolve, reject) => {
              server.closeAllConnections()
              server.close((error) => (error === undefined ? resolve() : reject(error)))
            })
          }
        }
      })()),
  }
}

/**
 * Serve `handler` on `host:port` (port 0 picks a free one) over Node's HTTP server and the
 * `@theokit/http` conversions. Built here rather than through `createNodeAdapter()`, whose `listen`
 * takes no host and binds every interface (plan D3). Resolves once the socket listens; a failing
 * bind rejects with `TheoClawBindError`.
 */
export async function listenControlPlane(options: ListenOptions): Promise<ControlPlaneHandle> {
  const server = createServer(serve(options))
  const refuse = (socket: Duplex, status: '401 Unauthorized' | '404 Not Found'): void =>
    refuseUpgrade(socket, status, options.stderr)
  const control =
    options.control === undefined
      ? undefined
      : attachControlSocket(server, options.control, refuse, options.stderr)
  if (control === undefined) {
    server.on('upgrade', (_request: IncomingMessage, socket: Duplex) => refuse(socket, '404 Not Found'))
  }
  await listen(server, options)
  // After the bind, a server-level error (an accept failure such as EMFILE) is written, not thrown.
  server.on('error', (error) => options.stderr(`theoclaw: control plane server error: ${describeError(error)}`))
  return handleFor(server, control, options.control?.sessions)
}
