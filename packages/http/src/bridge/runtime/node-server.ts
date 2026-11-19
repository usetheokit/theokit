/**
 * Standalone Node.js server — wraps a Web Standard handler with a client-disconnect signal,
 * upgrade hook, forced close and typed bind errors. Request/response conversion lives in node.ts.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'

import { nodeIncomingToRequest, writeResponseToNode } from './node.js'

export interface NodeServerOptions {
  /** Default true: the Request's signal aborts when the client disconnects before the response finished. */
  readonly abortOnDisconnect?: boolean
  /** Omitted: upgrade requests are answered with 404 and the socket is closed. */
  readonly onUpgrade?: (request: IncomingMessage, socket: Duplex, head: Buffer) => void
  readonly onError?: (error: unknown, phase: 'request' | 'server') => void
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
