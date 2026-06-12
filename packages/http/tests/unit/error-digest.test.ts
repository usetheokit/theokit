import { describe, it, expect, vi, afterEach } from 'vitest'
import { digestError } from '../../src/error-digest.js'
import { NotFoundException } from '../../src/exceptions/http-exception.js'

describe('Error Digest', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('test_digest_produces_stable_hash', () => {
    // Given: the same error thrown twice
    const err = new Error('something went wrong')

    // When: digested separately
    const a = digestError(err)
    const b = digestError(err)

    // Then: same digest
    expect(a.digest).toBe(b.digest)
    expect(typeof a.digest).toBe('string')
    expect(a.digest.length).toBeGreaterThan(0)
  })

  it('test_digest_different_errors_different_hash', () => {
    // Given: two different errors
    const err1 = new Error('error one')
    const err2 = new Error('error two')

    // When: digested
    const a = digestError(err1)
    const b = digestError(err2)

    // Then: different digests
    expect(a.digest).not.toBe(b.digest)
  })

  it('test_digest_includes_context', () => {
    // Given: an error with context
    const err = new Error('failed')
    const context = { route: '/api/users', phase: 'handler' as const, source: 'UserController' }

    // When: digested with context
    const result = digestError(err, context)

    // Then: context preserved
    expect(result.context.route).toBe('/api/users')
    expect(result.context.phase).toBe('handler')
    expect(result.context.source).toBe('UserController')
  })

  it('test_digest_strips_stack_in_production', () => {
    // Given: production environment
    vi.stubEnv('NODE_ENV', 'production')
    const err = new Error('production error')

    // When: digested
    const result = digestError(err)

    // Then: no stack trace
    expect(result.stack).toBeUndefined()
  })

  it('test_digest_keeps_stack_in_development', () => {
    // Given: development environment
    vi.stubEnv('NODE_ENV', 'development')
    const err = new Error('dev error')

    // When: digested
    const result = digestError(err)

    // Then: stack trace present
    expect(result.stack).toBeDefined()
    expect(result.stack).toContain('dev error')
  })

  it('test_digest_handles_string_throw', () => {
    // Given: a string thrown as error
    const err = 'raw string error'

    // When: digested
    const result = digestError(err)

    // Then: message is the string, status defaults to 500
    expect(result.message).toBe('raw string error')
    expect(result.status).toBe(500)
    expect(typeof result.digest).toBe('string')
  })

  it('test_digest_handles_number_throw', () => {
    // Given: a number thrown as error
    const err = 42

    // When: digested
    const result = digestError(err)

    // Then: message is the stringified number
    expect(result.message).toBe('42')
    expect(result.status).toBe(500)
  })

  it('test_digest_http_exception_preserves_status', () => {
    // Given: an HttpException with specific status
    const err = new NotFoundException('User not found')

    // When: digested
    const result = digestError(err, { route: '/api/users/99', phase: 'handler' })

    // Then: status preserved from HttpException
    expect(result.status).toBe(404)
    expect(result.message).toBe('User not found')
    expect(result.context.route).toBe('/api/users/99')
  })
})
