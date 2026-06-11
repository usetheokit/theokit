/**
 * RED tests for T1.3 helper — server/http/serialize-action-result.ts
 *
 * Per plan g3-server-actions-and-useaction v1.2 § Phase 1 / T1.3.
 * EC absorbed: EC-3 (response body size limit via PAYLOAD_TOO_LARGE).
 */
import { describe, expect, it } from 'vitest'

import {
  ActionError,
  ActionInputError,
} from '../../packages/theo/src/core/contracts/action-protocol.js'
import { serializeActionResult } from '../../packages/theo/src/server/http/serialize-action-result.js'

describe('serializeActionResult — data', () => {
  it('should emit application/json+devalue content-type for data', () => {
    const r = serializeActionResult({ data: 'hello', error: undefined })
    expect(r.type).toBe('data')
    if (r.type !== 'data') throw new Error('unreachable')
    expect(r.status).toBe(200)
    expect(r.contentType).toBe('application/json+devalue')
  })

  it('should emit a non-empty devalue body for rich types (Date, Set, URL)', () => {
    const data = {
      d: new Date('2024-01-01T00:00:00Z'),
      s: new Set([1, 2, 3]),
      u: new URL('https://example.com/foo'),
    }
    const r = serializeActionResult({ data, error: undefined })
    if (r.type !== 'data') throw new Error('unreachable')
    expect(r.body.length).toBeGreaterThan(0)
    // devalue encodes Date/Set/URL with type markers; we accept any well-formed
    // string body. Roundtrip is exercised by integration test with devalue
    // available in the consumer chain.
    expect(typeof r.body).toBe('string')
    // Sanity: not just JSON.stringify (would drop URL host)
    expect(r.body).toContain('example.com')
  })

  it('should preserve primitives including 0 / false / null in body', () => {
    // devalue wraps top-level primitives in a single-element array: `[0]`,
    // `[false]`, `[null]`, `[""]`. We assert that contract so refactors
    // catch shape regressions.
    const cases: [unknown, string][] = [
      [0, '[0]'],
      [false, '[false]'],
      [null, '[null]'],
      ['', '[""]'],
    ]
    for (const [value, expectedBody] of cases) {
      const r = serializeActionResult({ data: value, error: undefined })
      if (r.type !== 'data') throw new Error(`unreachable for ${String(value)}`)
      expect(r.body).toBe(expectedBody)
    }
  })
})

describe('serializeActionResult — empty', () => {
  it('should return type=empty status=204 when data is undefined and no error', () => {
    const r = serializeActionResult({ data: undefined, error: undefined })
    expect(r.type).toBe('empty')
    expect(r.status).toBe(204)
    // no body on empty per type narrowing
    expect('body' in r ? r.body : undefined).toBeUndefined()
  })
})

describe('serializeActionResult — error', () => {
  it('should emit application/json for ActionError with mapped status', () => {
    const r = serializeActionResult({
      data: undefined,
      error: new ActionError({ code: 'UNAUTHORIZED', message: 'Not logged in' }),
    })
    expect(r.type).toBe('error')
    if (r.type !== 'error') throw new Error('unreachable')
    expect(r.status).toBe(401)
    expect(r.contentType).toBe('application/json')
    const body = JSON.parse(r.body) as Record<string, unknown>
    expect(body.type).toBe('TheoActionError')
    expect(body.code).toBe('UNAUTHORIZED')
    expect(body.message).toBe('Not logged in')
  })

  it('should serialize ActionInputError with fields + issues payload', () => {
    const err = new ActionInputError([
      { path: ['email'], message: 'Invalid email' },
      { path: ['name'], message: 'Required' },
    ])
    const r = serializeActionResult({ data: undefined, error: err })
    expect(r.type).toBe('error')
    if (r.type !== 'error') throw new Error('unreachable')
    expect(r.status).toBe(422)
    const body = JSON.parse(r.body) as Record<string, unknown>
    expect(body.type).toBe('TheoActionInputError')
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(Array.isArray(body.issues)).toBe(true)
    expect((body.issues as unknown[]).length).toBe(2)
    expect(body.fields).toEqual({
      email: ['Invalid email'],
      name: ['Required'],
    })
  })
})

describe('serializeActionResult — invalid data (Astro pattern guard)', () => {
  it('should throw when data is a Response object', () => {
    expect(() => serializeActionResult({ data: new Response('nope'), error: undefined })).toThrow(
      /cannot serialize Response/i,
    )
  })
})

describe('serializeActionResult — EC-3 response body size limit', () => {
  it('should throw PAYLOAD_TOO_LARGE when serialized body exceeds responseBodySizeLimit', () => {
    // ~12 MB of repeated 'x' — exceeds default 5 MB limit
    const huge = 'x'.repeat(12 * 1024 * 1024)
    let caught: unknown
    try {
      serializeActionResult({ data: huge, error: undefined })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ActionError)
    expect((caught as ActionError).code).toBe('PAYLOAD_TOO_LARGE')
  })

  it('should respect custom responseBodySizeLimit option', () => {
    const moderately = 'y'.repeat(2 * 1024 * 1024) // 2 MB
    // Strict 1 MB limit should reject 2 MB body
    let caught: unknown
    try {
      serializeActionResult(
        { data: moderately, error: undefined },
        { responseBodySizeLimit: 1024 * 1024 },
      )
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(ActionError)
    expect((caught as ActionError).code).toBe('PAYLOAD_TOO_LARGE')

    // Generous 5 MB limit (default) should accept 2 MB body
    expect(() => serializeActionResult({ data: moderately, error: undefined })).not.toThrow()
  })
})
