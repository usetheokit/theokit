/**
 * Node.js runtime adapter — converts IncomingMessage/ServerResponse ↔ Request/Response.
 *
 * Per ADR D460: node:http types live ONLY in this adapter file.
 * The rest of the pipeline operates on Web Standard Request/Response.
 *
 * EC-1: Body converted via Readable.toWeb() for streaming (no full buffering).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable, type Duplex } from 'node:stream'

import {
  normalizeTrustedProxy,
  stampTrustedIdentity,
  type TrustedProxyOptions,
} from './trusted-proxy.js'
import type { RuntimeAdapter } from './types.js'

/** Convert Node.js IncomingMessage to Web Standard Request. */
export function nodeIncomingToRequest(nodeReq: IncomingMessage): Request {
  const proto = nodeReq.headers['x-forwarded-proto'] ?? 'http'
  const host = nodeReq.headers.host ?? 'localhost'
  const url = `${proto}://${host}${nodeReq.url ?? '/'}` // eslint-disable-line @typescript-eslint/restrict-template-expressions -- proto/host are string|string[]
  const method = nodeReq.method ?? 'GET'

  const headers = new Headers()
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        for (const v of value) headers.append(key, v)
      } else {
        headers.set(key, value)
      }
    }
  }

  // EC-1: Streaming body via Readable.toWeb() — no full buffering
  const hasBody = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
  const body = hasBody ? (Readable.toWeb(nodeReq) as ReadableStream) : undefined

  return new Request(url, {
    method,
    headers,
    body,
    // @ts-expect-error — duplex is required for streaming bodies in Node 18+
    duplex: hasBody ? 'half' : undefined,
  })
}

const isGone = (res: ServerResponse): boolean => res.destroyed

/** Write Web Standard Response to Node.js ServerResponse. */
export async function writeResponseToNode(
  response: Response,
  nodeRes: ServerResponse,
): Promise<void> {
  // Client left while the handler was still working: nothing to write, stop the producer.
  if (isGone(nodeRes)) {
    await response.body?.cancel().catch(() => undefined)
    return
  }
  nodeRes.writeHead(response.status, Object.fromEntries(response.headers.entries()))

  if (!response.body) {
    nodeRes.end()
    return
  }

  const reader = response.body.getReader()
  // Client left before the body ended: cancel the producer, even while a read is pending.
  const onClose = (): void => {
    if (!nodeRes.writableFinished) void reader.cancel().catch(() => undefined)
  }
  nodeRes.once('close', onClose)
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional infinite loop with break
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (isGone(nodeRes)) {
        await reader.cancel().catch(() => undefined)
        break
      }
      nodeRes.write(value)
    }
  } finally {
    nodeRes.off('close', onClose)
    try {
      reader.releaseLock()
    } catch {
      // a cancel still pending keeps the lock; nothing to release
    }
    if (!isGone(nodeRes)) nodeRes.end()
  }
}

/** Create a Node.js HTTP server that delegates to a Web Standard handler. */
export function createNodeAdapter(): RuntimeAdapter {
  return {
    createServer(handler, options) {
      const server = createServer((nodeReq, nodeRes) => {
        void (async () => {
          let request: Request | undefined
          try {
            request = nodeIncomingToRequest(nodeReq)
            const response = await handler(request)
            await writeResponseToNode(response, nodeRes)
          } catch (err) {
            // The real error goes to the server side only, never to the client (CWE-209).
            try {
              if (options?.onError) options.onError(err, request)
              else console.error(err)
            } catch {
              // a failing hook must not escape the last-resort handler
            }
            if (!nodeRes.headersSent && !nodeRes.destroyed) {
              nodeRes.writeHead(500, { 'content-type': 'application/json' })
              nodeRes.end(
                JSON.stringify({
                  error: {
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Internal Server Error',
                  },
                }),
              )
            }
          }
        })()
      })

      return {
        listen: (port: number, cb?: () => void, host = '127.0.0.1') =>
          server.listen(port, host, cb),
        close: (cb?: () => void) => server.close(cb),
        address: () => {
          const addr = server.address()
          if (typeof addr === 'string' || addr === null) return null
          return { port: addr.port }
        },
      }
    },
  }
}

export interface NodeServerOptions {
  /** Default true: the Request's signal aborts when the client disconnects before the response finished. */
  readonly abortOnDisconnect?: boolean
  /** Omitted: upgrade requests are answered with 404 and the socket is closed. */
  readonly onUpgrade?: (request: IncomingMessage, socket: Duplex, head: Buffer) => void
  readonly onError?: (error: unknown, phase: 'request' | 'server') => void
  /** Believe an identity header (and `x-forwarded-proto`) only from these peers. Invalid options throw. */
  readonly trustedProxy?: TrustedProxyOptions
}

export interface NodeServer {
  /** Rejects with BindError when the address cannot be bound. */
  listen(port: number, host?: string): Promise<{ host: string; port: number }>
  address(): { host: string; port: number } | null
  /** Memoized; `force` ends open connections (including upgraded sockets) first. */
  close(options?: { force?: boolean }): Promise<void>
  readonly server: Server
}

export class BindError extends Error {
  /** `EADDRINUSE`, `EADDRNOTAVAIL` or another system error code. */
  readonly code: string
  readonly host: string
  readonly port: number
  constructor(code: string, host: string, port: number, cause?: unknown) {
    let what = `cannot listen on ${host}:${String(port)} (${code})`
    if (code === 'EADDRINUSE') what = `port ${String(port)} is already in use on ${host}`
    else if (code === 'EADDRNOTAVAIL')
      what = `address ${host} is not available (port ${String(port)})`
    super(`Cannot bind: ${what}`, { cause })
    this.name = 'BindError'
    this.code = code
    this.host = host
    this.port = port
  }
}

/** Create a Node.js HTTP server around a Web Standard handler, with a client-disconnect signal. */
export function createNodeServer(
  handler: (request: Request) => Response | Promise<Response>,
  options: NodeServerOptions = {},
): NodeServer {
  const report = (error: unknown, phase: 'request' | 'server'): void => {
    try {
      if (options.onError) options.onError(error, phase)
      else console.error(error)
    } catch {
      // a failing hook must not escape
    }
  }
  const proxy = options.trustedProxy ? normalizeTrustedProxy(options.trustedProxy) : undefined
  const abortOnDisconnect = options.abortOnDisconnect !== false
  const upgraded = new Set<Duplex>()

  const server = createServer((nodeReq, nodeRes) => {
    void (async () => {
      try {
        const controller = new AbortController()
        if (abortOnDisconnect) {
          // Response side, not IncomingMessage: on Node 23+ the request closes once its body is read.
          nodeRes.once('close', () => {
            if (!nodeRes.writableFinished) controller.abort()
          })
        }
        stampTrustedIdentity(nodeReq, proxy)
        const base = nodeIncomingToRequest(nodeReq)
        const request = abortOnDisconnect ? new Request(base, { signal: controller.signal }) : base
        const response = await handler(request)
        await writeResponseToNode(response, nodeRes)
      } catch (err) {
        report(err, 'request')
        if (!nodeRes.headersSent && !nodeRes.destroyed) {
          nodeRes.writeHead(500, { 'content-type': 'text/plain' })
          nodeRes.end('Internal Server Error')
        } else if (!nodeRes.destroyed) {
          nodeRes.destroy()
        }
      }
    })()
  })

  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    upgraded.add(socket)
    socket.once('close', () => upgraded.delete(socket))
    if (options.onUpgrade) {
      try {
        options.onUpgrade(req, socket, head)
      } catch (err) {
        report(err, 'server')
        socket.destroy()
      }
      return
    }
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  })

  const address = (): { host: string; port: number } | null => {
    const addr = server.address()
    if (addr === null || typeof addr === 'string') return null
    const { address: host, port } = addr
    return { host, port }
  }

  let closing: Promise<void> | undefined

  return {
    server,
    address,
    listen: (port, host = '127.0.0.1') =>
      new Promise((resolve, reject) => {
        const onBindError = (err: NodeJS.ErrnoException): void => {
          reject(new BindError(err.code ?? 'UNKNOWN', host, port, err))
        }
        server.once('error', onBindError)
        server.listen(port, host, () => {
          server.off('error', onBindError)
          server.on('error', (err) => {
            report(err, 'server')
          })
          resolve(address() ?? { host, port })
        })
      }),
    close: (closeOptions) => {
      closing ??= new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve()
          return
        }
        server.close((err) => {
          if (err) reject(err)
          else resolve()
        })
        if (closeOptions?.force) {
          for (const s of upgraded) s.destroy()
          server.closeAllConnections()
        } else {
          server.closeIdleConnections()
        }
      })
      return closing
    },
  }
}
