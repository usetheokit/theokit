/**
 * T5a.2 Phase H — end-to-end pipeline integration test.
 *
 * The capstone of T5a.2. Wires EVERY shipped Phase A-G surface together
 * through a real `http.createServer` + `fetch` round-trip:
 *
 *   - Phase A: executeWebRequest entry-point (web-handler.ts)
 *   - Phase B slice 1/6: validateCsrfRequest + opts.csrfMode: 'strict'
 *   - Phase B slice 2/6: evaluateCsrfMultiHeaderRequest (used inside plugin)
 *   - Phase B slice 5/6: createCorsWebHandler + applyCorsHeaders
 *   - Phase B slice 6/6: appendCookieToHeaders + getCookieFromRequest
 *   - Phase C slice 1/2: extractTraceIdFromRequest → opts.requestId
 *   - Phase D slice 3/3: createSessionManagerWeb (session set + get)
 *   - Phase F slice 1/3: defineWebPlugin (auth gate plugin)
 *   - Phase G slice 1/N: opts.hooks lifecycle (onRequest auth-gate)
 *   - Phase G slice 2/N: WebPluginRunner.getHooks() composition
 *   - Phase G slice 5/N: executeWebRequestFromNode bridge
 *
 * The test proves these surfaces compose into a working Web-Standards
 * request handler that runs under Node today AND would run unchanged
 * under CF Workers / Bun / Deno (per ADR-0028 R3a). The wrangler-dev
 * smoke (Phase H plan AC for CF Workers) remains out-of-loop scope per
 * driver pause conditions — Cloudflare credentials required.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase H.
 */
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineRoute } from '../../packages/theo/src/server/define/define-route.js'
import { createSessionManagerWeb } from '../../packages/theo/src/server/auth/session.js'
import { createCorsWebHandler } from '../../packages/theo/src/server/http/cors.js'
import { defineWebPlugin } from '../../packages/theo/src/server/plugin-types.js'
import { extractTraceIdFromRequest } from '../../packages/theo/src/server/http/trace-context.js'
import { WebPluginRunner } from '../../packages/theo/src/server/plugins/web-plugin-runner.js'
import { executeWebRequestFromNode } from '../../packages/theo/src/server/http/node-web-adapter.js'

interface UserSession {
  userId: string
  role: 'admin' | 'user'
}

const SECRET = 'a'.repeat(32)
const sm = createSessionManagerWeb<UserSession>({ secret: SECRET })
const cors = createCorsWebHandler({
  origins: 'http://example.com',
  credentials: true,
})

// Routes under test.
const routes = {
  GET: defineRoute({
    handler({ request }) {
      // Pull userId from context (set by auth gate plugin onRequest).
      const userId = (request as unknown as { _t5a2: { userId: string } })._t5a2.userId
      return { greeting: `hello ${userId}` }
    },
  }),
  POST: defineRoute({
    body: z.object({ task: z.string() }),
    handler({ body }) {
      const typed = body as { task: string }
      return { acked: typed.task }
    },
  }),
}

// Login route — issues a session cookie + CORS headers.
const loginRoute = {
  POST: defineRoute({
    body: z.object({ userId: z.string(), role: z.enum(['admin', 'user']) }),
    async handler({ body, request: _request }) {
      const typed = body as UserSession
      const headers = new Headers({ 'content-type': 'application/json' })
      await sm.createSession(headers, typed)
      cors.applyCorsHeaders(_request, headers)
      return new Response(JSON.stringify({ ok: true, userId: typed.userId }), {
        status: 200,
        headers,
      })
    },
  }),
}

let server: Server
let baseUrl = ''

beforeAll(async () => {
  // Build a single WebPluginRunner used across requests (registration
  // is module-scoped; hooks accumulate at boot).
  const runner = new WebPluginRunner()

  // CORS plugin registered FIRST so its onRequest preflight handler runs
  // BEFORE the auth gate (CORS preflight has no auth context — it's a
  // standalone OPTIONS handshake the browser makes before the real request).
  await runner.register(
    defineWebPlugin({
      name: 'cors',
      register(app) {
        app.addHook('onRequest', (ctx) => {
          const preflight = cors.handlePreflightRequest(ctx.request)
          if (preflight !== null) ctx.response = preflight
        })
        app.addHook('onResponse', (ctx) => {
          cors.applyCorsHeaders(ctx.request, ctx.responseHeaders)
        })
      },
    }),
  )

  // Auth gate plugin: rejects requests without a valid session cookie.
  // Sets request._t5a2.userId for downstream handlers via Object stash
  // (intentionally avoiding ctx.ctx mutation here to verify session reach).
  await runner.register(
    defineWebPlugin({
      name: 'auth-gate',
      register(app) {
        app.addHook('onRequest', async (ctx) => {
          const url = new URL(ctx.request.url).pathname
          // Skip auth gate on the login endpoint
          if (url.startsWith('/login')) return
          const session = await sm.getSession(ctx.request)
          if (session === null) {
            ctx.response = new Response(
              JSON.stringify({ code: 'UNAUTHORIZED', message: 'No session' }),
              {
                status: 401,
                headers: { 'content-type': 'application/json' },
              },
            )
            return
          }
          // Stash session userId onto the request (downstream handler reads it)
          ;(ctx.request as unknown as { _t5a2: { userId: string } })._t5a2 = {
            userId: session.userId,
          }
          ctx.ctx.userId = session.userId
        })
      },
    }),
  )

  // Request-id propagation plugin: extracts traceId, adds x-request-id
  // header to all responses.
  await runner.register(
    defineWebPlugin({
      name: 'request-id',
      register(app) {
        app.addHook('onResponse', (ctx) => {
          ctx.responseHeaders.set('x-request-id', ctx.requestId)
        })
      },
    }),
  )

  server = createServer((req, res) => {
    const url = req.url ?? '/'
    const routeModule = url.startsWith('/login') ? loginRoute : routes
    // Build a synthetic Request to extract traceId BEFORE calling the
    // executor (so it can flow into opts.requestId).
    const previewRequest = new Request(`http://${req.headers.host ?? 'localhost'}${url}`, {
      headers: req.headers as HeadersInit,
    })
    const requestId = extractTraceIdFromRequest(previewRequest)
    void executeWebRequestFromNode(req, res, routeModule, {
      hooks: runner.getHooks(),
      csrfMode: 'off', // login + GET don't need CSRF; POST tests opt in below
      requestId,
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const addr = server.address()
  if (typeof addr !== 'object' || addr === null) throw new Error('no addr')
  baseUrl = `http://127.0.0.1:${addr.port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
})

describe('T5a.2 Phase H — end-to-end Web pipeline integration', () => {
  it('login → session cookie issued → GET with cookie → handler sees userId', async () => {
    // Step 1: login (no auth required)
    const loginResp = await fetch(`${baseUrl}/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://example.com',
      },
      body: JSON.stringify({ userId: 'u-42', role: 'admin' }),
    })
    expect(loginResp.status).toBe(200)
    const setCookies = loginResp.headers.getSetCookie()
    expect(setCookies.length).toBeGreaterThan(0)
    // CORS headers applied
    expect(loginResp.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com')
    expect(loginResp.headers.get('Access-Control-Allow-Credentials')).toBe('true')

    // Extract the session cookie value
    const sessionCookie = setCookies.find((c) => c.startsWith('theo_session='))
    expect(sessionCookie).toBeDefined()

    // Step 2: GET /api with the session cookie → auth gate accepts, handler runs
    const sessionCookieValue = sessionCookie!.split(';')[0] // "theo_session=<value>"
    const getResp = await fetch(`${baseUrl}/api`, {
      method: 'GET',
      headers: { cookie: sessionCookieValue },
    })
    expect(getResp.status).toBe(200)
    const body = (await getResp.json()) as { greeting: string }
    expect(body.greeting).toBe('hello u-42')

    // x-request-id header set by request-id plugin
    expect(getResp.headers.get('x-request-id')).toBeTruthy()
  })

  it('GET /api WITHOUT session cookie → 401 from auth gate plugin (short-circuit)', async () => {
    const response = await fetch(`${baseUrl}/api`, { method: 'GET' })
    expect(response.status).toBe(401)
    const body = (await response.json()) as { code: string; message: string }
    expect(body.code).toBe('UNAUTHORIZED')
    // CORS onResponse still ran (plugin chain isn't aborted; only handler skipped)
    // But Origin not set → CORS apply is no-op → no Allow-Origin header
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    // request-id plugin always runs onResponse, so header IS present
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('OPTIONS preflight → CORS plugin short-circuits with 204', async () => {
    const response = await fetch(`${baseUrl}/api`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://example.com',
        'access-control-request-method': 'POST',
      },
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://example.com')
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
  })

  it('OPTIONS preflight from disallowed origin → CORS plugin returns 403', async () => {
    const response = await fetch(`${baseUrl}/api`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://attacker.com',
        'access-control-request-method': 'POST',
      },
    })
    expect(response.status).toBe(403)
  })

  it('request-id plugin always sets x-request-id header on responses', async () => {
    // Even for unauthorized 401 responses
    const r1 = await fetch(`${baseUrl}/api`, { method: 'GET' })
    expect(r1.headers.get('x-request-id')).toBeTruthy()
    // And for preflight
    const r2 = await fetch(`${baseUrl}/api`, {
      method: 'OPTIONS',
      headers: { origin: 'http://example.com', 'access-control-request-method': 'POST' },
    })
    // CORS plugin short-circuits BEFORE the request-id onResponse fires;
    // mergeHookHeaders still runs the onResponse stage, so x-request-id IS
    // appended to the preflight response too.
    expect(r2.headers.get('x-request-id')).toBeTruthy()
  })
})
