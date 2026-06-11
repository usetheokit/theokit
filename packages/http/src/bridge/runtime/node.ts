/**
 * Node.js runtime adapter — converts IncomingMessage/ServerResponse ↔ Request/Response.
 *
 * Per ADR D460: node:http types live ONLY in this adapter file.
 * The rest of the pipeline operates on Web Standard Request/Response.
 *
 * EC-1: Body converted via Readable.toWeb() for streaming (no full buffering).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

import type { RuntimeAdapter } from './types.js'

/** Convert Node.js IncomingMessage to Web Standard Request. */
export function nodeIncomingToRequest(nodeReq: IncomingMessage): Request {
  const proto = nodeReq.headers['x-forwarded-proto'] ?? 'http'
  const host = nodeReq.headers.host ?? 'localhost'
  const url = `${proto}://${host}${nodeReq.url ?? "/"}` // eslint-disable-line @typescript-eslint/restrict-template-expressions -- proto/host are string|string[]
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
  const body = hasBody ? Readable.toWeb(nodeReq) as ReadableStream : undefined

  return new Request(url, {
    method,
    headers,
    body,
    // @ts-expect-error — duplex is required for streaming bodies in Node 18+
    duplex: hasBody ? 'half' : undefined,
  })
}

/** Write Web Standard Response to Node.js ServerResponse. */
export async function writeResponseToNode(response: Response, nodeRes: ServerResponse): Promise<void> {
  nodeRes.writeHead(response.status, Object.fromEntries(response.headers.entries()))

  if (!response.body) {
    nodeRes.end()
    return
  }

  const reader = response.body.getReader()
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- intentional infinite loop with break
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (nodeRes.destroyed) break
      nodeRes.write(value)
    }
  } finally {
    reader.releaseLock()
    if (!nodeRes.destroyed) nodeRes.end()
  }
}

/** Create a Node.js HTTP server that delegates to a Web Standard handler. */
export function createNodeAdapter(): RuntimeAdapter {
  return {
    createServer(handler) {
      const server = createServer((nodeReq, nodeRes) => {
        void (async () => {
        try {
          const request = nodeIncomingToRequest(nodeReq)
          const response = await handler(request)
          await writeResponseToNode(response, nodeRes)
        } catch (err) {
          if (!nodeRes.destroyed) {
            nodeRes.writeHead(500, { 'content-type': 'application/json' })
            nodeRes.end(JSON.stringify({
              error: { code: 'INTERNAL_SERVER_ERROR', message: err instanceof Error ? err.message : 'Unknown error' },
            }))
          }
        }
        })()
      })

      return {
        listen: (port: number, cb?: () => void) => server.listen(port, cb),
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
