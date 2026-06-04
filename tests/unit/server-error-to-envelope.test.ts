/**
 * RED tests for G5 T2.5 — boundary translation: ad-hoc Error class -> envelope.
 *
 * Per plan g5-error-envelope-cross-layer v1.0 § Phase 2 / T2.5.
 * Blueprint ADR D3 — single boundary translation point; preserves class
 * identity inside the codebase (no invasive call-site rewrites) while emitting
 * canonical envelope at the wire boundary.
 *
 * Acceptance: every documented runtime-Error class maps to the correct
 * TheoErrorCode; envelope.message preserves original; envelope.meta?.name
 * carries the source class identity for diagnostics.
 */
import { describe, expect, it } from 'vitest'

import { serverErrorToEnvelope } from '../../packages/theo/src/core/contracts/server-error-to-envelope.js'
import { AuthRequiredError } from '../../packages/theo/src/server/auth/auth.js'
import { RequestBodyTooLargeError } from '../../packages/theo/src/server/body-parser-web.js'
import { FileTooLargeError } from '../../packages/theo/src/server/body-parser.js'
import { BodyTooLargeError } from '../../packages/theo/src/server/webhook/raw-body.js'
import { RouterConventionError } from '../../packages/theo/src/server/scan/errors.js'

describe('serverErrorToEnvelope (G5 T2.5)', () => {
  it('should map AuthRequiredError to UNAUTHORIZED envelope', () => {
    // Given: a session-required failure thrown by requireAuth()
    const err = new AuthRequiredError('Token expired')

    // When: translated at boundary
    const env = serverErrorToEnvelope(err)

    // Then: envelope code is canonical UNAUTHORIZED + message preserved
    expect(env.code).toBe('UNAUTHORIZED')
    expect(env.message).toBe('Token expired')
    expect(env.meta?.name).toBe('AuthRequiredError')
  })

  it('should map FileTooLargeError to PAYLOAD_TOO_LARGE envelope', () => {
    // Given: a multipart upload exceeding size budget
    const err = new FileTooLargeError('File too large', ['huge.bin'], 1_048_576)

    // Then: envelope is canonical PAYLOAD_TOO_LARGE
    const env = serverErrorToEnvelope(err)
    expect(env.code).toBe('PAYLOAD_TOO_LARGE')
    expect(env.meta?.name).toBe('FileTooLargeError')
    // Migration-aware meta carries class-specific context for debugging
    expect((env.meta as { truncatedFilenames?: string[] })?.truncatedFilenames).toEqual([
      'huge.bin',
    ])
  })

  it('should map RequestBodyTooLargeError to PAYLOAD_TOO_LARGE envelope', () => {
    // Given: Content-Length exceeds max
    const err = new RequestBodyTooLargeError(10_000_000, 1_048_576)

    // Then: PAYLOAD_TOO_LARGE
    const env = serverErrorToEnvelope(err)
    expect(env.code).toBe('PAYLOAD_TOO_LARGE')
    expect(env.meta?.name).toBe('RequestBodyTooLargeError')
  })

  it('should map BodyTooLargeError (webhook) to PAYLOAD_TOO_LARGE envelope', () => {
    // Given: webhook raw-body exceeds limit
    const err = new BodyTooLargeError(1024, 2048)

    // Then: PAYLOAD_TOO_LARGE
    const env = serverErrorToEnvelope(err)
    expect(env.code).toBe('PAYLOAD_TOO_LARGE')
    expect(env.meta?.name).toBe('BodyTooLargeError')
  })

  it('should map RouterConventionError to INTERNAL_SERVER_ERROR with hint extension', () => {
    // Given: scanner rejected dotted-basename route at build time
    const err = new RouterConventionError({
      file: 'server/routes/auth.[provider].login.ts',
      suggestion: 'server/routes/auth/[provider]/login.ts',
    })

    // Then: envelope code is INTERNAL_SERVER_ERROR + ext carries migration hint
    const env = serverErrorToEnvelope(err)
    expect(env.code).toBe('INTERNAL_SERVER_ERROR')
    expect(env.meta?.name).toBe('RouterConventionError')
    expect((env.ext as { hint?: string })?.hint).toMatch(/theokit migrate router/)
  })

  it('should default unknown Error classes to INTERNAL_SERVER_ERROR', () => {
    // Given: a generic JS Error
    const err = new Error('something unexpected')

    // Then: safe fallback envelope is emitted
    const env = serverErrorToEnvelope(err)
    expect(env.code).toBe('INTERNAL_SERVER_ERROR')
    expect(env.message).toBe('something unexpected')
  })

  it('should pass through TheoError instances without re-wrapping', async () => {
    // Given: an envelope-aware error already
    const { TheoError } = await import('../../packages/theo/src/core/contracts/theo-error.js')
    const err = new TheoError({ code: 'BAD_REQUEST', message: 'Already canonical' })

    // When: translated at boundary
    const env = serverErrorToEnvelope(err)

    // Then: envelope identity is preserved
    expect(env.code).toBe('BAD_REQUEST')
    expect(env.message).toBe('Already canonical')
  })
})
