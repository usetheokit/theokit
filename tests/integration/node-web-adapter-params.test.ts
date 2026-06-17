import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { IncomingMessage, ServerResponse } from 'node:http'

import { executeWebRequestFromNode } from '../../packages/theo/src/server/http/node-web-adapter.js'

/**
 * T3.1/T3.2 wiring — `executeWebRequestFromNode` is the production Node→Web
 * composer (the documented bridge api-middleware/CLI-start will adopt during the
 * D4-deferred Node→Web convergence). This proves the composer threads opts.params
 * + opts.middleware end-to-end through the real Node req/res boundary, not just
 * the executeWebRequest seam.
 */
function mockReq(method: string, url: string): IncomingMessage {
  return { method, url, headers: { host: 'x' } } as unknown as IncomingMessage
}
function mockRes() {
  const chunks: Uint8Array[] = []
  const res = {
    statusCode: 0,
    headers: {} as Record<string, unknown>,
    setHeader(k: string, v: unknown) {
      this.headers[k] = v
    },
    writeHead(status: number, _statusText?: string, headers?: Record<string, string>) {
      this.statusCode = status
      Object.assign(this.headers, headers ?? {})
      return this
    },
    write(chunk: Uint8Array) {
      chunks.push(chunk)
      return true
    },
    end() {},
  }
  return {
    res: res as unknown as ServerResponse,
    body: () => Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'),
    status: () => res.statusCode,
  }
}

describe('executeWebRequestFromNode threads params + middleware (production composer)', () => {
  it('test_composer_threads_matchroute_params_to_handler', async () => {
    const route = {
      GET: {
        params: z.object({ id: z.string() }),
        handler: ({ params }: { params: unknown }) => ({ id: (params as { id: string }).id }),
      },
    }
    const { res, body, status } = mockRes()
    await executeWebRequestFromNode(mockReq('GET', '/users/42'), res, route, {
      params: { id: '42' },
    })
    expect(status()).toBe(200)
    expect(JSON.parse(body())).toEqual({ id: '42' })
  })

  it('test_composer_threads_middleware_short_circuit', async () => {
    let handlerRan = false
    const route = {
      GET: {
        handler: () => {
          handlerRan = true
          return { ok: true }
        },
      },
    }
    const { res, status } = mockRes()
    await executeWebRequestFromNode(mockReq('GET', '/admin'), res, route, {
      middleware: [() => new Response('no', { status: 403 })],
    })
    expect(status()).toBe(403)
    expect(handlerRan).toBe(false)
  })
})
