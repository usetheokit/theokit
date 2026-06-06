/**
 * Web-standards handler boundary — RED tests for T1.2.
 *
 * These tests prove the contract that Phase 5a (T5a.1 — R3a Hono Web
 * standards migration per ADR-0028) will implement:
 *   - TheoKit handlers accept a native `Request` and return a native
 *     `Response` (or `Promise<Response>`).
 *   - No `node:*` import is required inside the handler body — Web
 *     standards (`Request` / `Response` / `Headers` / `ReadableStream`
 *     / `Web Crypto`) cover the surface.
 *   - Streaming responses use `ReadableStream`, not `node:stream`.
 *
 * Current state (pre-T5a.1): the framework's `executeRoute` consumes
 * Node's `IncomingMessage` + `ServerResponse`. There is no Web-shaped
 * entry-point. The 4 RED tests below call `executeWebRequest` which
 * does not exist today — they fail with explicit "not implemented yet"
 * messages until Phase 5a lands.
 *
 * EC-5 honest framing (per plan T1.2 + edge-case review):
 *   Vitest runs under Node, where `node:*` modules are always
 *   resolvable. A vitest test CANNOT prove "no node:* required" —
 *   it can only prove the handler ACCEPTS a Web Request and returns a
 *   Web Response. The real proof of node-free execution is
 *   `wrangler dev tests/fixtures/handler-web-standards/` returning 200.
 *   The CI matrix gains a wrangler smoke job in Phase 5a; vitest tests
 *   here are necessary but not sufficient.
 *
 * BDD scenarios (per plan T1.2):
 *   - Happy path: GET with empty query → 200 + JSON body
 *   - Validation error: POST with Zod schema mismatch → 400
 *   - Edge case: empty body request → handler treats as undefined, no crash
 *   - Error scenario: handler throws → 500 with TheoError envelope
 *     (envelope shape post-T4.1; today vitest under-asserts the body)
 */

import { describe, it, expect } from 'vitest'

import { GET, POST } from '../fixtures/handler-web-standards/route.js'

/**
 * Helper: invoke the future Web-standards entry-point.
 *
 * Post-T5a.1 the framework will expose `executeWebRequest(request, ctx)`
 * (or equivalent — exact name lands in Phase 5a). Today this method
 * does NOT exist — the test routes through a dynamic lookup so the
 * RED state is structurally honest.
 */
async function executeWebRequest(
  request: Request,
  routeModule: { GET?: unknown; POST?: unknown },
): Promise<Response> {
  // Dynamic-import the future server module entry point.
  const serverModule = (await import('../../packages/theo/src/server/index.js')) as Record<
    string,
    unknown
  >
  const fn = serverModule.executeWebRequest as
    | ((req: Request, mod: typeof routeModule) => Promise<Response>)
    | undefined
  if (typeof fn !== 'function') {
    throw new Error(
      `theokit/server.executeWebRequest is not implemented yet — Phase 5a (T5a.1) ` +
        `will add it per ADR-0028. This test is intentionally RED until then.`,
    )
  }
  return fn(request, routeModule)
}

describe('Web-standards handler boundary (T1.2 RED → Phase 5a GREEN)', () => {
  // RED-1
  it('handler accepts a native Web Request and returns a native Response', async () => {
    const request = new Request('http://localhost/api/test', { method: 'GET' })
    const response = await executeWebRequest(request, { GET })
    expect(response).toBeInstanceOf(Response)
  })

  // RED-2 — vitest can't truly prove this (EC-5 honest framing); the
  // real proof is `wrangler dev` smoke. This test asserts the surrogate:
  // the handler module itself contains no top-level `node:*` import.
  it('handler module does not import node:* at the top level', async () => {
    // Force a fresh module evaluation in a separate import context that
    // would surface a node:* ReferenceError if it were attempted in an
    // environment where node:* is unavailable. Vitest under Node has
    // node:* available — so this is a structural surrogate, not the
    // real proof. Real proof: wrangler dev smoke.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const url = await import('node:url')
    const here = path.dirname(url.fileURLToPath(import.meta.url))
    const routePath = path.resolve(here, '../fixtures/handler-web-standards/route.ts')
    const source = fs.readFileSync(routePath, 'utf8')
    expect(source).not.toMatch(/from ['"]node:/)
    expect(source).not.toMatch(/require\(['"]node:/)
  })

  // RED-3
  it('handler response IS instance of native Response (not Node ServerResponse)', async () => {
    const request = new Request('http://localhost/api/test', { method: 'GET' })
    const response = await executeWebRequest(request, { GET })
    // Native Response from the standard library has these instance traits:
    expect(typeof response.text).toBe('function')
    expect(typeof response.json).toBe('function')
    expect(typeof response.headers.get).toBe('function')
    expect(typeof response.status).toBe('number')
  })

  // RED-4 — streaming via ReadableStream, not node:stream
  it('handler can stream a Response body using ReadableStream', async () => {
    const request = new Request('http://localhost/api/test', { method: 'GET' })
    const response = await executeWebRequest(request, { GET })
    // Response body in Web standards is a ReadableStream (nullable for
    // empty bodies, but the API surface MUST be the Web type).
    if (response.body !== null) {
      // Calling getReader() is a Web standards API; on Node streams it
      // would not exist. The structural assertion is sufficient at
      // vitest level (real proof remains wrangler dev).
      const reader = response.body.getReader()
      expect(typeof reader.read).toBe('function')
      reader.releaseLock()
    }
  })
})

describe('Web-standards handler — BDD scenarios (T1.2)', () => {
  // Happy path
  it('happy path: GET empty query → 200 with JSON body', async () => {
    const request = new Request('http://localhost/api/test', { method: 'GET' })
    const response = await executeWebRequest(request, { GET })
    expect(response.status).toBe(200)
    const json = (await response.json()) as { ok: boolean; message: string }
    expect(json.ok).toBe(true)
    expect(json.message).toContain('web-standards')
  })

  // Validation error
  it('validation error: POST with Zod schema mismatch → 400', async () => {
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wrong_field: true }), // schema expects { name: string }
    })
    const response = await executeWebRequest(request, { POST })
    expect(response.status).toBe(400)
  })

  // Edge case: empty body request
  it('edge case: empty body POST → handler treats as undefined, no crash', async () => {
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '',
    })
    // Expect SOME response (400 from Zod, OR 422). Critical assertion:
    // the framework must not crash with `Cannot read property of undefined`.
    const response = await executeWebRequest(request, { POST })
    expect([400, 422]).toContain(response.status)
  })

  // Error scenario: handler throws → 500 with TheoError envelope
  it('error scenario: handler throws → 500 with TheoError envelope (post-T4.1 shape)', async () => {
    // Build a route module whose handler throws.
    const throwingRoute = {
      GET: {
        ...GET,
        handler() {
          throw new Error('boom from handler')
        },
      },
    }
    const request = new Request('http://localhost/api/test', { method: 'GET' })
    const response = await executeWebRequest(request, throwingRoute)
    expect(response.status).toBe(500)
    // Post-T4.1, the body MUST be a TheoErrorEnvelope (code + message).
    // Today (RED) the executeWebRequest does not exist; once it lands the
    // envelope shape is the cross-layer contract.
    const body = (await response.json()) as {
      code?: string
      message?: string
    }
    expect(typeof body.code).toBe('string')
    expect(typeof body.message).toBe('string')
  })
})
