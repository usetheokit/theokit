/**
 * RED tests for G5 T2.4 — G3 ActionError envelope adoption
 *
 * Per plan g5-error-envelope-cross-layer v1.0 § Phase 2 / T2.4.
 * Blueprint Recommendations § "G3 ActionError becomes inaugural envelope user".
 *
 * Non-breaking: extends ActionError + ActionInputError with `.envelope` getter;
 * legacy `.code`, `.status`, `.fields`, `.issues` accessors preserved.
 */
import { describe, expect, it } from 'vitest'

import {
  ActionError,
  ActionInputError,
} from '../../packages/theo/src/core/contracts/action-protocol.js'
import type { TheoErrorEnvelope } from '../../packages/theo/src/core/contracts/error-envelope.js'

describe('ActionError.envelope (G5 T2.4)', () => {
  it('should expose envelope getter with code + message', () => {
    // Given: a server-side ActionError
    const err = new ActionError({ code: 'UNAUTHORIZED', message: 'Token expired' })

    // Then: the envelope view exposes the canonical shape
    const env: TheoErrorEnvelope = err.envelope
    expect(env.code).toBe('UNAUTHORIZED')
    expect(env.message).toBe('Token expired')
  })

  it('should map ActionErrorCode UNPROCESSABLE_ENTITY-like codes to envelope codes', () => {
    // Given: a VALIDATION_ERROR (the G3 historic shape)
    const err = new ActionError({ code: 'VALIDATION_ERROR' })

    // Then: envelope code is UNPROCESSABLE_ENTITY (canonical TheoErrorCode
    // per blueprint Recommendations — VALIDATION_ERROR is the G3-specific
    // synonym mapping to HTTP 422)
    expect(err.envelope.code).toBe('UNPROCESSABLE_ENTITY')
  })

  it('should preserve legacy .code/.status getters (backward compat)', () => {
    // Given: a generic 500 ActionError
    const err = new ActionError({ code: 'INTERNAL_SERVER_ERROR', message: 'boom' })

    // Then: legacy flat fields still work for existing call sites
    expect(err.code).toBe('INTERNAL_SERVER_ERROR')
    expect(err.status).toBe(500)
  })
})

describe('ActionInputError.envelope (G5 T2.4)', () => {
  it('should expose ValidationFieldsExt in envelope.ext', () => {
    // Given: a validation failure with field-level issues
    const issues = [
      { path: ['email'], message: 'invalid email' },
      { path: ['address', 'zip'], message: 'required' },
    ]
    const err = new ActionInputError(issues)

    // Then: envelope carries ValidationFieldsExt in ext
    const env = err.envelope
    expect(env.code).toBe('UNPROCESSABLE_ENTITY')
    const ext = env.ext!
    expect(ext.fields.email).toEqual(['invalid email'])
    expect(ext.fields['address.zip']).toEqual(['required'])
  })

  it('should preserve legacy .fields getter (backward compat)', () => {
    // Given: validation errors
    const err = new ActionInputError([{ path: ['name'], message: 'too short' }])

    // Then: legacy .fields still works (G3 useAction consumers depend on it)
    expect(err.fields.name).toEqual(['too short'])
  })

  it('should preserve legacy .issues getter (backward compat)', () => {
    // Given: validation errors
    const issues = [{ path: ['email'], message: 'invalid' }]
    const err = new ActionInputError(issues)

    // Then: .issues still surfaces the raw normalized issues
    expect(err.issues).toHaveLength(1)
    expect(err.issues[0]?.message).toBe('invalid')
  })
})
