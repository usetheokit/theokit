/**
 * RED tests for G5 T2.1 — TheoFetchError envelope adoption
 *
 * Per plan g5-error-envelope-cross-layer v1.0 § Phase 2 / T2.1.
 * Blueprint Recommendations § Migration impact bullet "theokit/client".
 */
import { describe, expect, it } from 'vitest'

import { TheoFetchError } from '../../packages/theo/src/client/theo-fetch.js'
import type { TheoErrorEnvelope } from '../../packages/theo/src/core/contracts/error-envelope.js'

describe('TheoFetchError envelope adoption (G5 T2.1)', () => {
  it('should expose envelope when body matches TheoErrorEnvelope shape', () => {
    // Given: a wire body with the canonical envelope shape
    const body = {
      code: 'PRECONDITION_FAILED',
      message: 'EMBEDDER_REQUIRED',
      ext: { hint: 'Set OPENAI_API_KEY' },
    }

    // When: TheoFetchError is constructed from a 412 response
    const err = new TheoFetchError(412, body)

    // Then: envelope getter returns the normalized envelope
    const env: TheoErrorEnvelope = err.envelope
    expect(env.code).toBe('PRECONDITION_FAILED')
    expect(env.message).toBe('EMBEDDER_REQUIRED')
    expect((env.ext as { hint: string }).hint).toBe('Set OPENAI_API_KEY')
  })

  it('should derive envelope from legacy { error: {...} } body (backward compat)', () => {
    // Given: a legacy wire body where the envelope is nested under `error`
    const body = {
      error: {
        code: 'UNAUTHORIZED',
        message: 'Token expired',
      },
    }

    // When: TheoFetchError is constructed
    const err = new TheoFetchError(401, body)

    // Then: envelope is normalized (no double-wrap, no `.error.error`)
    const env = err.envelope
    expect(env.code).toBe('UNAUTHORIZED')
    expect(env.message).toBe('Token expired')
  })

  it('should default code to INTERNAL_SERVER_ERROR when body has no code', () => {
    // Given: a generic 500 response body
    const body = { message: 'something broke' }

    // When: TheoFetchError is constructed
    const err = new TheoFetchError(500, body)

    // Then: envelope still emits a valid TheoErrorCode
    const env = err.envelope
    expect(env.code).toBe('INTERNAL_SERVER_ERROR')
  })

  it('should preserve legacy .status getter', () => {
    // Given: a 429 response
    const err = new TheoFetchError(429, { error: { code: 'TOO_MANY_REQUESTS' } })

    // Then: .status accessor still works (no breakage in existing call sites)
    expect(err.status).toBe(429)
  })

  it('should preserve legacy .code getter', () => {
    // Given: a 403 response with explicit code
    const err = new TheoFetchError(403, { error: { code: 'FORBIDDEN' } })

    // Then: .code reflects the envelope code
    expect(err.code).toBe('FORBIDDEN')
  })

  it('should preserve legacy .issues getter for backward compat with G3 ActionInputError', () => {
    // Given: a 422 response carrying G3-shape issues
    const body = {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        issues: [{ path: ['email'], message: 'invalid email' }],
      },
    }
    const err = new TheoFetchError(422, body)

    // Then: .issues still surfaces the validation issues
    expect(err.issues).toHaveLength(1)
  })
})
