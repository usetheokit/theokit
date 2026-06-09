/**
 * RED tests for G5 T1.2 — core/contracts/theo-error.ts
 *
 * Per plan g5-error-envelope-cross-layer v1.0 § Phase 1 / T1.2.
 * Blueprint ADR D1 (Form 4) + ADR D5 (server-only meta filter at boundary).
 */
import { describe, it, expect } from 'vitest'

import { TheoError, fromUnknown } from '../../packages/theo/src/core/contracts/theo-error.js'
import type { TheoErrorEnvelope } from '../../packages/theo/src/core/contracts/error-envelope.js'

describe('TheoError constructor', () => {
  it('should accept { code, message, cause?, meta?, ext? } and expose envelope', () => {
    // Given: a TheoError constructed with all fields
    const err = new TheoError({
      code: 'BAD_REQUEST',
      message: 'Invalid email',
      cause: new Error('regex mismatch'),
      meta: { requestId: 'req-123' },
      ext: { hint: 'Use the format user@example.com' },
    })

    // Then: envelope getter exposes the full shape
    const env: TheoErrorEnvelope = err.envelope
    expect(env.code).toBe('BAD_REQUEST')
    expect(env.message).toBe('Invalid email')
    expect(env.meta).toEqual({ requestId: 'req-123' })
    expect((env.ext as { hint: string }).hint).toBe('Use the format user@example.com')
    expect((env.cause as Error).message).toBe('regex mismatch')
  })

  it('should expose .code accessor for switch-narrowing', () => {
    // Given: a TheoError with code=RATE_LIMITED
    const err = new TheoError({ code: 'RATE_LIMITED', message: 'Slow down' })

    // Then: .code returns the canonical TheoErrorCode
    expect(err.code).toBe('RATE_LIMITED')
  })

  it('should be instanceof Error (TC39 cause-chain compatible)', () => {
    // Given: a TheoError instance
    const err = new TheoError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' })

    // Then: instanceof Error is true (subclass) and stack is populated
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(TheoError)
    expect(err.stack).toBeTruthy()
  })

  it('should preserve TC39 proposal-error-cause chain', () => {
    // Given: an underlying cause
    const inner = new Error('underlying problem')
    const err = new TheoError({ code: 'INTERNAL_SERVER_ERROR', message: 'wrap', cause: inner })

    // Then: cause is preserved (both via JS standard slot and envelope)
    expect((err as Error & { cause?: unknown }).cause).toBe(inner)
    expect(err.envelope.cause).toBe(inner)
  })

  it('should set name === "TheoError" for serialization + telemetry', () => {
    // Given: a fresh TheoError
    const err = new TheoError({ code: 'NOT_FOUND', message: 'missing' })

    // Then: name is the canonical discriminator
    expect(err.name).toBe('TheoError')
  })
})

describe('TheoError.toJSON serialization', () => {
  it('should emit envelope shape', () => {
    // Given: a TheoError with ext slot
    const err = new TheoError({
      code: 'UNAUTHORIZED',
      message: 'Token expired',
      ext: { hint: 'Refresh your session' },
    })

    // When: serialized via JSON.stringify (calls toJSON)
    const json = JSON.parse(JSON.stringify(err)) as TheoErrorEnvelope<{ hint: string }>

    // Then: only envelope fields are emitted (no class-internal name/stack)
    expect(json.code).toBe('UNAUTHORIZED')
    expect(json.message).toBe('Token expired')
    expect(json.ext?.hint).toBe('Refresh your session')
  })

  it('should strip meta.stack in non-dev (NODE_ENV=production)', () => {
    // Given: NODE_ENV is production and meta contains a stack
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const err = new TheoError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'fail',
        meta: { stack: 'Error: leaked\n    at ...', requestId: 'req-1' },
      })

      // When: serialized
      const json = JSON.parse(JSON.stringify(err)) as TheoErrorEnvelope

      // Then: stack is stripped; other meta keys preserved
      expect(json.meta?.stack).toBeUndefined()
      expect(json.meta?.requestId).toBe('req-1')
    } finally {
      process.env.NODE_ENV = prev
    }
  })

  it('should preserve meta.stack in dev (NODE_ENV=development)', () => {
    // Given: NODE_ENV is development
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const err = new TheoError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'fail',
        meta: { stack: 'Error: visible\n    at ...' },
      })

      // When: serialized
      const json = JSON.parse(JSON.stringify(err)) as TheoErrorEnvelope

      // Then: stack is preserved for debugging
      expect(json.meta?.stack).toBe('Error: visible\n    at ...')
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})

describe('fromUnknown(value)', () => {
  it('should pass through existing TheoError instances unchanged', () => {
    // Given: an existing TheoError
    const original = new TheoError({ code: 'NOT_FOUND', message: 'missing' })

    // When: wrapped via fromUnknown
    const wrapped = fromUnknown(original)

    // Then: same reference returned (no double-wrap)
    expect(wrapped).toBe(original)
  })

  it('should wrap a plain Error into INTERNAL_SERVER_ERROR envelope', () => {
    // Given: a plain Error
    const plain = new Error('boom')

    // When: wrapped
    const wrapped = fromUnknown(plain)

    // Then: code is INTERNAL_SERVER_ERROR and cause chain points to original
    expect(wrapped.code).toBe('INTERNAL_SERVER_ERROR')
    expect(wrapped.message).toBe('boom')
    expect((wrapped as Error & { cause?: unknown }).cause).toBe(plain)
  })

  it('should wrap non-Error values (string, undefined, object) safely', () => {
    // Given: various non-Error inputs
    const w1 = fromUnknown('something failed')
    const w2 = fromUnknown(undefined)
    const w3 = fromUnknown({ weird: 'object' })

    // Then: all become INTERNAL_SERVER_ERROR with meaningful messages
    expect(w1.code).toBe('INTERNAL_SERVER_ERROR')
    expect(w1.message).toContain('something failed')
    expect(w2.code).toBe('INTERNAL_SERVER_ERROR')
    expect(w3.code).toBe('INTERNAL_SERVER_ERROR')
  })
})
