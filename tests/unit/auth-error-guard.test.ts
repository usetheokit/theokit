import { describe, expect, it } from 'vitest'

import { isAuthRequiredError } from '../../packages/theo/src/core/contracts/auth-error-guard.js'

describe('isAuthRequiredError', () => {
  it('should detect an object with code AUTH_REQUIRED and status 401', () => {
    expect(isAuthRequiredError({ code: 'AUTH_REQUIRED', status: 401 })).toBe(true)
  })

  it('should detect an error-like object with extra fields', () => {
    const err = { code: 'AUTH_REQUIRED', status: 401, message: 'Login required', stack: '...' }
    expect(isAuthRequiredError(err)).toBe(true)
  })

  it('should reject a non-auth error', () => {
    expect(isAuthRequiredError({ code: 'NOT_FOUND', status: 404 })).toBe(false)
  })

  it('should reject when code matches but status does not', () => {
    expect(isAuthRequiredError({ code: 'AUTH_REQUIRED', status: 403 })).toBe(false)
  })

  it('should reject when status matches but code does not', () => {
    expect(isAuthRequiredError({ code: 'FORBIDDEN', status: 401 })).toBe(false)
  })

  it('should handle null', () => {
    expect(isAuthRequiredError(null)).toBe(false)
  })

  it('should handle undefined', () => {
    expect(isAuthRequiredError(undefined)).toBe(false)
  })

  it('should handle non-object values', () => {
    expect(isAuthRequiredError('string')).toBe(false)
    expect(isAuthRequiredError(42)).toBe(false)
    expect(isAuthRequiredError(true)).toBe(false)
  })

  it('should handle empty object', () => {
    expect(isAuthRequiredError({})).toBe(false)
  })
})
