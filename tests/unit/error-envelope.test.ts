/**
 * RED tests for G5 T1.1 — core/contracts/error-envelope.ts
 *
 * Per plan g5-error-envelope-cross-layer v1.0 § Phase 1 / T1.1.
 * Blueprint ADRs D1 (Form 4 Hybrid) + D2 (retryable+hint as extensions).
 */
import { describe, it, expect, expectTypeOf } from 'vitest'

import {
  type TheoErrorCode,
  type TheoErrorEnvelope,
  type ValidationFieldsExt,
  type RetryableExt,
  type HintExt,
  isRetryable,
  RETRYABLE_CODES,
} from '../../packages/theo/src/core/contracts/error-envelope.js'

describe('TheoErrorCode union', () => {
  it('should accept canonical HTTP-status string-literals', () => {
    // Given: typed assignments for the documented base codes
    const code1: TheoErrorCode = 'BAD_REQUEST'
    const code2: TheoErrorCode = 'UNAUTHORIZED'
    const code3: TheoErrorCode = 'INTERNAL_SERVER_ERROR'

    // Then: all assignments compile (compile-time assertion)
    expect([code1, code2, code3]).toEqual(['BAD_REQUEST', 'UNAUTHORIZED', 'INTERNAL_SERVER_ERROR'])
  })

  it('should accept SDK/agent-domain codes', () => {
    // Given: SDK domain codes per blueprint Recommendations
    const code1: TheoErrorCode = 'AGENT_RUN_ERROR'
    const code2: TheoErrorCode = 'PROVIDER_KEY_MISSING'
    const code3: TheoErrorCode = 'BUDGET_EXCEEDED'
    const code4: TheoErrorCode = 'RATE_LIMITED'
    const code5: TheoErrorCode = 'CREDENTIAL_POOL_EXHAUSTED'

    // Then: all are valid TheoErrorCode members
    expect([code1, code2, code3, code4, code5]).toHaveLength(5)
  })
})

describe('TheoErrorEnvelope shape', () => {
  it('should require code + message; cause/meta/ext optional', () => {
    // Given: a minimal envelope with only required fields
    const env: TheoErrorEnvelope = {
      code: 'BAD_REQUEST',
      message: 'Invalid input',
    }

    // Then: envelope is well-formed with only required fields populated
    expect(env.code).toBe('BAD_REQUEST')
    expect(env.message).toBe('Invalid input')
    expect(env.cause).toBeUndefined()
    expect(env.meta).toBeUndefined()
    expect(env.ext).toBeUndefined()
  })

  it('should accept generic ext for per-domain extension types', () => {
    // Given: an envelope generic over a ValidationFieldsExt
    const env: TheoErrorEnvelope<ValidationFieldsExt> = {
      code: 'UNPROCESSABLE_ENTITY',
      message: 'Validation failed',
      ext: { fields: { email: ['must be a valid email'] } },
    }

    // Then: ext.fields is typed and accessible
    expectTypeOf(env.ext).toEqualTypeOf<ValidationFieldsExt | undefined>()
    expect(env.ext?.fields.email).toEqual(['must be a valid email'])
  })
})

describe('isRetryable', () => {
  it('should return true for documented retryable codes', () => {
    // Given: each documented retryable code
    const retryableCodes: TheoErrorCode[] = [
      'BAD_GATEWAY',
      'SERVICE_UNAVAILABLE',
      'GATEWAY_TIMEOUT',
      'INTERNAL_SERVER_ERROR',
      'TOO_MANY_REQUESTS',
      'RATE_LIMITED',
    ]

    // Then: isRetryable returns true for every one
    for (const code of retryableCodes) {
      expect(isRetryable({ code })).toBe(true)
    }
  })

  it('should return false for non-retryable codes', () => {
    // Given: codes that must NOT be retried
    const nonRetryable: TheoErrorCode[] = [
      'BAD_REQUEST',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'UNPROCESSABLE_ENTITY',
      'AGENT_RUN_ERROR',
      'PROVIDER_KEY_MISSING',
      'BUDGET_EXCEEDED',
    ]

    // Then: every code yields false
    for (const code of nonRetryable) {
      expect(isRetryable({ code })).toBe(false)
    }
  })
})

describe('Extension types', () => {
  it('ValidationFieldsExt mirrors G3 ActionInputError.fields shape', () => {
    // Given: a fields map keyed by dot-notation path
    const ext: ValidationFieldsExt = {
      fields: {
        '': ['root-level error'],
        email: ['must be a valid email'],
        'address.zip': ['required', 'must be 5 digits'],
        'items.0.name': ['too short'],
      },
    }

    // Then: the type accepts the canonical G3 shape
    expectTypeOf(ext.fields).toEqualTypeOf<Record<string, string[]>>()
    expect(ext.fields['address.zip']).toHaveLength(2)
  })

  it('RetryableExt carries retryAfterMs optional hint', () => {
    // Given: a transient failure envelope
    const ext: RetryableExt = { retryable: true, retryAfterMs: 5_000 }
    // And: a retryable failure with no specific hint
    const ext2: RetryableExt = { retryable: true }

    // Then: both shapes are valid
    expect(ext.retryAfterMs).toBe(5_000)
    expect(ext2.retryAfterMs).toBeUndefined()
  })

  it('HintExt carries developer-facing remediation string', () => {
    // Given: an envelope with a hint
    const ext: HintExt = { hint: 'Set OPENAI_API_KEY in .env before invoking this route' }

    // Then: the string is preserved verbatim
    expect(ext.hint).toMatch(/OPENAI_API_KEY/)
  })
})

describe('RETRYABLE_CODES set', () => {
  it('exposes a read-only Set of retryable codes for consumer derivation', () => {
    // When: consumer inspects the canonical retryable-set
    // Then: it contains every documented retryable code
    expect(RETRYABLE_CODES.has('BAD_GATEWAY')).toBe(true)
    expect(RETRYABLE_CODES.has('RATE_LIMITED')).toBe(true)
    // And: a non-retryable code is absent
    expect(RETRYABLE_CODES.has('UNAUTHORIZED')).toBe(false)
  })
})
