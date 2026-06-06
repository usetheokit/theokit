/**
 * T5a.2 Phase G slice 3/N — handleWebRequestError tests.
 *
 * Verifies the Web-Standards error handler returns a native `Response`
 * with envelope-shaped body for any error class via the G5 D3 boundary
 * translation (serverErrorToEnvelope) PLUS preserves the legacy auth
 * error detection (instanceof + duck-type fallback).
 *
 * Per `docs/plans/t5a2-incoming-message-to-request-shape-refactor-plan.md`
 * v1.0 § Phase G.
 */
import { describe, it, expect } from 'vitest'

import { AuthRequiredError } from '../../packages/theo/src/server/auth/auth.js'
import { handleWebRequestError } from '../../packages/theo/src/server/http/handle-request-error.js'
import { FileTooLargeError } from '../../packages/theo/src/server/body-parser.js'
import { TheoError } from '../../packages/theo/src/core/contracts/theo-error.js'

describe('handleWebRequestError (T5a.2 Phase G slice 3/N — Web shape)', () => {
  // === Auth path (instanceof + duck-type) ===

  it('AuthRequiredError instance → 401 + AUTH_REQUIRED envelope', async () => {
    const err = new AuthRequiredError('Token expired')
    const response = await handleWebRequestError(err)
    expect(response.status).toBe(401)
    const body = (await response.json()) as { code: string; message: string }
    expect(body.code).toBe('AUTH_REQUIRED')
    expect(body.message).toBe('Token expired')
  })

  it('duck-typed auth error (code+status, no instanceof) → 401 (cross-module class identity safety)', async () => {
    // Simulates the Vite-dev / vitest duplicate-class-identity case
    // where `err instanceof AuthRequiredError` is false but the err has
    // the canonical { code: 'AUTH_REQUIRED', status: 401 } shape.
    const err = { code: 'AUTH_REQUIRED', status: 401, message: 'Session expired' }
    const response = await handleWebRequestError(err)
    expect(response.status).toBe(401)
    const body = (await response.json()) as { code: string; message: string }
    expect(body.code).toBe('AUTH_REQUIRED')
    expect(body.message).toBe('Session expired')
  })

  // === Envelope translation for non-auth errors ===

  it('plain Error → 500 + INTERNAL_SERVER_ERROR envelope', async () => {
    const err = new Error('database connection lost')
    const response = await handleWebRequestError(err)
    expect(response.status).toBe(500)
    const body = (await response.json()) as { code: string; message: string }
    expect(body.code).toBe('INTERNAL_SERVER_ERROR')
    expect(body.message).toBe('database connection lost')
  })

  it('FileTooLargeError → 413 + PAYLOAD_TOO_LARGE envelope (via serverErrorToEnvelope mapping)', async () => {
    const err = new FileTooLargeError('upload too big', ['huge.bin'], 1_048_576)
    const response = await handleWebRequestError(err)
    expect(response.status).toBe(413)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('TheoError pass-through with custom code → correct HTTP status', async () => {
    const err = new TheoError({ code: 'RATE_LIMITED', message: 'Quota exhausted' })
    const response = await handleWebRequestError(err)
    expect(response.status).toBe(429)
    const body = (await response.json()) as { code: string; message: string }
    expect(body.code).toBe('RATE_LIMITED')
    expect(body.message).toBe('Quota exhausted')
  })

  it('non-Error value (string throw) → 500 INTERNAL_SERVER_ERROR with string as message', async () => {
    const response = await handleWebRequestError('something went wrong')
    expect(response.status).toBe(500)
    const body = (await response.json()) as { code: string; message: string }
    expect(body.code).toBe('INTERNAL_SERVER_ERROR')
    expect(body.message).toBe('something went wrong')
  })

  it('non-Error value (random object throw) → 500 with safe fallback message', async () => {
    const response = await handleWebRequestError({ random: 'shape' })
    expect(response.status).toBe(500)
    const body = (await response.json()) as { code: string }
    expect(body.code).toBe('INTERNAL_SERVER_ERROR')
  })

  // === requestId propagation ===

  it('emits x-request-id header when ctx.requestId provided', async () => {
    const err = new Error('boom')
    const response = await handleWebRequestError(err, { requestId: 'req-abc-123' })
    expect(response.headers.get('x-request-id')).toBe('req-abc-123')
  })

  it('omits x-request-id header when ctx.requestId undefined', async () => {
    const err = new Error('boom')
    const response = await handleWebRequestError(err)
    expect(response.headers.get('x-request-id')).toBeNull()
  })

  // === Content-Type always set ===

  it('always emits content-type: application/json', async () => {
    const cases: Array<{ name: string; err: unknown }> = [
      { name: 'auth', err: new AuthRequiredError('token') },
      { name: 'plain', err: new Error('boom') },
      { name: 'string', err: 'string error' },
      { name: 'theo', err: new TheoError({ code: 'BAD_REQUEST', message: 'invalid' }) },
    ]
    for (const c of cases) {
      const response = await handleWebRequestError(c.err)
      expect(response.headers.get('content-type'), c.name).toContain('application/json')
    }
  })
})
