import type { Server } from 'node:http'

import { BindError, createNodeServer, type TrustedProxyOptions } from '@theokit/http/runtime/node'

import { bindControlSocket, type ControlSocket, type ControlSocketOptions } from './control-socket.js'
import { describeError, TheoClawBindError } from './errors.js'

export type RequestHandler = (request: Request) => Promise<Response>

export interface ListenOptions {
  readonly handler: RequestHandler
  readonly port: number
  readonly host: string
  /** The `/control` socket. Without it every upgrade is refused 404. */
  readonly control?: ControlSocketOptions
  /** Trusted-proxy mode: an identity header from an allowlisted peer marks the request (OC-24). */
  readonly trustedProxy?: TrustedProxyOptions
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

/** Map a failing `listen` to the typed refusal: a busy port names the port, a foreign address the address. */
function bindFailure(error: unknown, options: ListenOptions): unknown {
  if (!(error instanceof BindError)) return error
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
  return error.cause ?? error
}

/**
 * Serve `handler` on `host:port` (port 0 picks a free one) with the framework's `createNodeServer`,
 * which binds the host it is given, aborts a request's signal when its client leaves, stamps the
 * trusted-proxy identity and ends every upgraded socket on a forced close. Resolves once the socket
 * listens; a failing bind rejects with `TheoClawBindError`. The `/control` socket listens on the
 * same server; the server's own upgrade refusal is switched off while it does, because the socket
 * answers every upgrade itself (404 for another path, 401 for a wrong token).
 */
export async function listenControlPlane(options: ListenOptions): Promise<ControlPlaneHandle> {
  const node = createNodeServer(options.handler, {
    ...(options.control === undefined ? {} : { onUpgrade: () => undefined }),
    ...(options.trustedProxy === undefined ? {} : { trustedProxy: options.trustedProxy }),
    onError: (error, phase) =>
      options.stderr(
        phase === 'request'
          ? `theoclaw: request failed: ${describeError(error)}`
          : `theoclaw: control plane server error: ${describeError(error)}`,
      ),
  })
  const control: ControlSocket | undefined =
    options.control === undefined ? undefined : bindControlSocket(node.server, options.control, options.stderr)
  try {
    await node.listen(options.port, options.host)
  } catch (error) {
    // A socket attached to a server that never listened still holds its upgrade listener.
    await control?.close()
    throw bindFailure(error, options)
  }
  let closing: Promise<void> | undefined
  return {
    server: node.server,
    address: () => {
      const address = node.address()
      if (address === null) throw new Error('the control plane is not listening on a TCP address')
      return address
    },
    // Memoized: a second call waits for the first close instead of failing ERR_SERVER_NOT_RUNNING.
    close: () =>
      (closing ??= (async () => {
        // The control clients end first, then the session agents, which outlive their turns.
        try {
          await control?.close()
        } finally {
          try {
            await options.control?.sessions?.close()
          } finally {
            await node.close({ force: true })
          }
        }
      })()),
  }
}
