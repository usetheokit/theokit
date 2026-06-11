/**
 * T5a.2 Phase B slice 3/6 — Web-Standards CSRF readiness handler tests.
 *
 * Verifies `handleCsrfReadinessRequest(request, store): Promise<Response | null>`
 * is a behaviour-equivalent mirror of `handleCsrfReadiness(req, res, store):
 * Promise<boolean>` for the Web Request shape. Returns `Response` when the
 * URL matches; returns `null` when not (caller short-circuits accordingly).
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase B. The IncomingMessage tests in `csrf-readiness-endpoint.test.ts`
 * cover the legacy path; this file covers the Web Request path.
 */
import { describe, it, expect, beforeEach } from 'vitest'

import { CsrfReadinessStore } from '../../packages/theo/src/server/security/csrf-readiness-store.js'
import {
  CSRF_READINESS_PATH,
  CSRF_READINESS_RESET_PATH,
  handleCsrfReadinessRequest,
} from '../../packages/theo/src/server/security/csrf-readiness-endpoint.js'

describe('handleCsrfReadinessRequest (T5a.2 Phase B slice 3/6 — Web shape)', () => {
  let store: CsrfReadinessStore

  beforeEach(() => {
    store = new CsrfReadinessStore()
  })

  // === Non-matching URL → null ===

  it('returns null when URL does not match either readiness path', async () => {
    const request = new Request('http://example.com/api/some-other-route', { method: 'GET' })
    const response = await handleCsrfReadinessRequest(request, store)
    expect(response).toBeNull()
  })

  // === GET /__theo/csrf-readiness ===

  it('GET /__theo/csrf-readiness returns 200 + summary JSON', async () => {
    const request = new Request(`http://example.com${CSRF_READINESS_PATH}`, { method: 'GET' })
    const response = await handleCsrfReadinessRequest(request, store)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(200)
    expect(response!.headers.get('content-type')).toContain('application/json')
    const body = (await response!.json()) as Record<string, unknown>
    // CsrfReadinessStore.summary() returns the structured snapshot — shape
    // is API-stable; we just verify it parses.
    expect(typeof body).toBe('object')
  })

  it('POST /__theo/csrf-readiness → 405 METHOD_NOT_ALLOWED', async () => {
    const request = new Request(`http://example.com${CSRF_READINESS_PATH}`, { method: 'POST' })
    const response = await handleCsrfReadinessRequest(request, store)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(405)
    const body = (await response!.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED')
    expect(body.error.message).toContain('GET')
  })

  // === POST /__theo/csrf-readiness/reset (CSRF dog-food) ===

  it('GET /__theo/csrf-readiness/reset → 405 METHOD_NOT_ALLOWED', async () => {
    const request = new Request(`http://example.com${CSRF_READINESS_RESET_PATH}`, {
      method: 'GET',
    })
    const response = await handleCsrfReadinessRequest(request, store)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(405)
  })

  it('POST reset without X-Theo-Action header → 403 CSRF_INVALID', async () => {
    const request = new Request(`http://example.com${CSRF_READINESS_RESET_PATH}`, {
      method: 'POST',
    })
    const response = await handleCsrfReadinessRequest(request, store)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(403)
    const body = (await response!.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('CSRF_INVALID')
    expect(body.error.message).toContain('X-Theo-Action')
  })

  it('POST reset with X-Theo-Action but cross-origin → 403 CSRF_INVALID', async () => {
    const request = new Request(`http://example.com${CSRF_READINESS_RESET_PATH}`, {
      method: 'POST',
      headers: {
        'x-theo-action': '1',
        origin: 'http://attacker.com',
        host: 'example.com',
      },
    })
    const response = await handleCsrfReadinessRequest(request, store)
    expect(response).not.toBeNull()
    expect(response!.status).toBe(403)
  })

  it('POST reset with X-Theo-Action + same-origin → 204 + store.reset() invoked', async () => {
    // Given: store has had some events tracked
    store.record({ method: 'POST', path: '/api/test', reason: 'missing X-Theo-Action' })
    const summaryBefore = store.summary()
    expect(summaryBefore.totalEvents).toBeGreaterThan(0)

    // When: reset POST with valid CSRF
    const request = new Request(`http://example.com${CSRF_READINESS_RESET_PATH}`, {
      method: 'POST',
      headers: {
        'x-theo-action': '1',
        origin: 'http://example.com',
        host: 'example.com',
      },
    })
    const response = await handleCsrfReadinessRequest(request, store)

    // Then: 204 No Content + store cleared
    expect(response).not.toBeNull()
    expect(response!.status).toBe(204)
    const summaryAfter = store.summary()
    expect(summaryAfter.totalEvents).toBe(0)
  })

  it('POST reset uses request.url fallback for same-origin check when host header absent', async () => {
    // Given: no host header — but Web Request guarantees absolute request.url
    const request = new Request(`http://example.com${CSRF_READINESS_RESET_PATH}`, {
      method: 'POST',
      headers: {
        'x-theo-action': '1',
        origin: 'http://example.com',
      },
    })
    const response = await handleCsrfReadinessRequest(request, store)
    expect(response).not.toBeNull()
    // Fallback uses request.url's host (example.com) → matches Origin
    expect(response!.status).toBe(204)
  })
})
