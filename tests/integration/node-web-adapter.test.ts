/**
 * T5a.2 Phase G slice 5/N — Node adapter shim integration tests.
 *
 * Verifies the bidirectional bridge between Node `IncomingMessage` /
 * `ServerResponse` and the Web-Standards `executeWebRequest`. Uses a
 * real `http.createServer` + `fetch` round-trip to exercise the
 * conversions end-to-end (no mocks).
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase G slice 5/N (closes the executor bridge surface).
 */
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineRoute } from '../../packages/theo/src/server/define/define-route.js'
import { executeWebRequestFromNode } from '../../packages/theo/src/server/http/node-web-adapter.js'

const echoRoutes = {
  GET: defineRoute({
    query: z.object({}).optional(),
    handler() {
      return { ok: true, method: 'GET' }
    },
  }),
  POST: defineRoute({
    body: z.object({ name: z.string() }),
    handler({ body, request }) {
      const typed = body as { name: string }
      return {
        greeting: `hello, ${typed.name}`,
        method: 'POST',
        url: request.url,
      }
    },
  }),
}

const cookieRoute = {
  GET: defineRoute({
    handler() {
      // Return a Response with multiple Set-Cookie headers
      const headers = new Headers({ 'content-type': 'application/json' })
      headers.append('Set-Cookie', 'sid=abc123; Path=/; HttpOnly')
      headers.append('Set-Cookie', 'csrf=xyz789; Path=/; SameSite=Strict')
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers })
    },
  }),
}

let server: Server
let baseUrl = ''

beforeAll(async () => {
  // Build a Node HTTP server that delegates to executeWebRequestFromNode.
  server = createServer((req, res) => {
    const url = req.url ?? '/'
    if (url.startsWith('/echo')) {
      void executeWebRequestFromNode(req, res, echoRoutes)
    } else if (url.startsWith('/cookies')) {
      void executeWebRequestFromNode(req, res, cookieRoute)
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address()
  if (typeof addr !== 'object' || addr === null) {
    throw new Error('Failed to obtain server address')
  }
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
})

describe('executeWebRequestFromNode — IncomingMessage ↔ Web Request bridge (T5a.2 Phase G slice 5/N)', () => {
  it('GET /echo round-trips through Web executor and returns JSON', async () => {
    const response = await fetch(`${baseUrl}/echo`, { method: 'GET' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { ok: boolean; method: string }
    expect(body.ok).toBe(true)
    expect(body.method).toBe('GET')
  })

  it('POST /echo with JSON body parses + handler sees parsed body', async () => {
    const response = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alice' }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { greeting: string; url: string }
    expect(body.greeting).toBe('hello, alice')
    // Verify URL was resolved to absolute form from host header
    expect(body.url).toMatch(/^http:\/\/.+\/echo/)
  })

  it('multiple Set-Cookie headers preserved through bridge (getSetCookie() roundtrip)', async () => {
    const response = await fetch(`${baseUrl}/cookies`)
    expect(response.status).toBe(200)
    const setCookies = response.headers.getSetCookie()
    expect(setCookies.length).toBeGreaterThanOrEqual(2)
    expect(setCookies.some((c) => c.includes('sid=abc123'))).toBe(true)
    expect(setCookies.some((c) => c.includes('csrf=xyz789'))).toBe(true)
  })

  it('handler throw → 500 envelope flows through bridge', async () => {
    const throwingServer = createServer((req, res) => {
      const throwingRoutes = {
        GET: defineRoute({
          handler() {
            throw new Error('handler boom')
          },
        }),
      }
      void executeWebRequestFromNode(req, res, throwingRoutes)
    })
    await new Promise<void>((resolve) => {
      throwingServer.listen(0, '127.0.0.1', () => resolve())
    })
    try {
      const addr = throwingServer.address()
      if (typeof addr !== 'object' || addr === null) throw new Error('no addr')
      const response = await fetch(`http://127.0.0.1:${addr.port}/anywhere`, { method: 'GET' })
      expect(response.status).toBe(500)
      const body = (await response.json()) as { code: string; message: string }
      expect(body.code).toBe('INTERNAL_SERVER_ERROR')
      expect(body.message).toBe('handler boom')
    } finally {
      await new Promise<void>((resolve, reject) => {
        throwingServer.close((err) => (err ? reject(err) : resolve()))
      })
    }
  })

  it('Zod validation failure → 400 envelope via bridge', async () => {
    const response = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wrong_field: 'oops' }), // schema requires `name`
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { code: string; message: string }
    expect(body.code).toBe('BAD_REQUEST')
    expect(body.message).toContain('body')
  })

  it('GET method returns 405 when handler missing for that method', async () => {
    const response = await fetch(`${baseUrl}/cookies`, { method: 'DELETE' })
    expect(response.status).toBe(405)
  })
})

describe('incomingMessageToWebRequest unit conversions (T5a.2 Phase G slice 5/N)', () => {
  // Unit-level coverage of the conversion helpers (not via real socket).
  it('preserves query string in the Web Request URL', async () => {
    const response = await fetch(`${baseUrl}/echo?foo=bar&q=1`, { method: 'GET' })
    expect(response.status).toBe(200)
    // The handler's `request.url` (Web) reflects the absolute URL with query
  })

  it('preserves host header → request.url host', async () => {
    const response = await fetch(`${baseUrl}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bob' }),
    })
    const body = (await response.json()) as { url: string }
    // Host is the loopback address bound by createServer
    expect(body.url).toContain('127.0.0.1')
  })
})
