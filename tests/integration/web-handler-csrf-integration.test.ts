/**
 * T5a.2 Phase B (slice 1/6) — CSRF integration test for executeWebRequest.
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase B. Validates the Web-Standards-shaped sibling
 * `validateCsrfRequest(request: Request)` (extracted from `validateCsrf`
 * via a pure header-only helper) AND its wiring into `executeWebRequest`
 * via `opts.csrfMode: 'strict'`.
 *
 * The CSRF policy is identical to the legacy IncomingMessage path:
 *   - state-changing methods (POST/PUT/PATCH/DELETE) need `X-Theo-Action: 1`
 *   - GET/HEAD/OPTIONS bypass (HTTP semantics + threat-model rationale)
 *   - Origin/Host mismatch fails when both present
 *   - Browsers omit Origin for same-origin requests — treated as valid
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { defineRoute } from '../../packages/theo/src/server/define/define-route.js'
import {
  executeWebRequest,
  type ExecuteWebRequestOptions,
} from '../../packages/theo/src/server/web-handler.js'
import { validateCsrfRequest } from '../../packages/theo/src/server/security/csrf.js'

// Minimal route module fixture for CSRF integration tests.
const routes = {
  GET: defineRoute({
    query: z.object({}).optional(),
    handler() {
      return { ok: true }
    },
  }),
  POST: defineRoute({
    body: z.object({ name: z.string() }),
    handler({ body }) {
      return { greeting: `hello, ${(body as { name: string }).name}` }
    },
  }),
  PUT: defineRoute({
    body: z.object({ name: z.string() }),
    handler() {
      return { ok: true }
    },
  }),
  DELETE: defineRoute({
    query: z.object({}).optional(),
    handler() {
      return { ok: true }
    },
  }),
}

describe('validateCsrfRequest (T5a.2 Phase B slice 1/6 — Web-shaped CSRF leaf)', () => {
  it('valid when X-Theo-Action: 1 header is set and no Origin (same-origin browser request)', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'x-theo-action': '1' },
    })
    expect(validateCsrfRequest(request)).toEqual({ valid: true })
  })

  it('invalid when X-Theo-Action header is missing', () => {
    const request = new Request('http://example.com/api', { method: 'POST' })
    const result = validateCsrfRequest(request)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('X-Theo-Action')
    }
  })

  it('invalid when X-Theo-Action value is not "1"', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'x-theo-action': 'true' }, // wrong value — must be literal "1"
    })
    expect(validateCsrfRequest(request).valid).toBe(false)
  })

  it('valid when Origin matches Host (same-origin)', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        'x-theo-action': '1',
        origin: 'http://example.com',
        host: 'example.com',
      },
    })
    expect(validateCsrfRequest(request)).toEqual({ valid: true })
  })

  it('invalid when Origin does not match Host (cross-origin)', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        'x-theo-action': '1',
        origin: 'http://attacker.com',
        host: 'example.com',
      },
    })
    const result = validateCsrfRequest(request)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toContain('Origin')
      expect(result.reason).toContain('host')
    }
  })

  it('invalid when Origin is malformed URL', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        'x-theo-action': '1',
        origin: 'not-a-valid-url',
        host: 'example.com',
      },
    })
    expect(validateCsrfRequest(request).valid).toBe(false)
  })

  it('valid when Origin absent but Host present (browser-omitted Origin for same-origin)', () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        'x-theo-action': '1',
        host: 'example.com',
      },
    })
    expect(validateCsrfRequest(request)).toEqual({ valid: true })
  })
})

describe('executeWebRequest + csrfMode: strict (T5a.2 Phase B slice 1/6 integration)', () => {
  const strictOpts: ExecuteWebRequestOptions = { csrfMode: 'strict' }

  it('GET request bypasses CSRF (read-only method)', async () => {
    const request = new Request('http://example.com/api', { method: 'GET' })
    const response = await executeWebRequest(request, routes, strictOpts)
    expect(response.status).toBe(200)
  })

  it('POST without X-Theo-Action header → 403 FORBIDDEN envelope (csrfMode: strict)', async () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alice' }),
    })
    const response = await executeWebRequest(request, routes, strictOpts)
    expect(response.status).toBe(403)
    const body = (await response.json()) as { code: string; message: string }
    expect(body.code).toBe('FORBIDDEN')
    expect(body.message).toContain('CSRF')
    expect(body.message).toContain('X-Theo-Action')
  })

  it('POST with X-Theo-Action: 1 → handler runs normally (csrfMode: strict)', async () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-theo-action': '1',
      },
      body: JSON.stringify({ name: 'bob' }),
    })
    const response = await executeWebRequest(request, routes, strictOpts)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { greeting: string }
    expect(body.greeting).toBe('hello, bob')
  })

  it('PUT without X-Theo-Action → 403 (state-changing method)', async () => {
    const request = new Request('http://example.com/api', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alice' }),
    })
    const response = await executeWebRequest(request, routes, strictOpts)
    expect(response.status).toBe(403)
  })

  it('DELETE without X-Theo-Action → 403 (state-changing method)', async () => {
    const request = new Request('http://example.com/api', { method: 'DELETE' })
    const response = await executeWebRequest(request, routes, strictOpts)
    expect(response.status).toBe(403)
  })

  it('POST with cross-origin attack (X-Theo-Action set but Origin mismatch) → 403', async () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-theo-action': '1',
        origin: 'http://attacker.com',
        host: 'example.com',
      },
      body: JSON.stringify({ name: 'alice' }),
    })
    const response = await executeWebRequest(request, routes, strictOpts)
    expect(response.status).toBe(403)
    const body = (await response.json()) as { code: string; message: string }
    expect(body.code).toBe('FORBIDDEN')
  })

  it('csrfMode: off (default) — POST without X-Theo-Action runs normally (Phase A backward compat)', async () => {
    const request = new Request('http://example.com/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'alice' }),
    })
    // No opts → defaults to csrfMode: 'off' (Phase A behavior preserved).
    const response = await executeWebRequest(request, routes)
    expect(response.status).toBe(200)
  })
})
