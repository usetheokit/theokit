import { describe, expect, it } from 'vitest'

import {
  GuardConfigError,
  bearerCheck,
  bearerGuard,
  readBearerToken,
} from '../../src/guards/index.js'

const T = 'a'.repeat(32)

describe('bearerCheck', () => {
  const check = bearerCheck(T)
  it('accepts the scheme in any case', () => {
    expect(check(`Bearer ${T}`)).toBe(true)
    expect(check(`bearer ${T}`)).toBe(true)
  })
  it.each([`Bearer ${'b'.repeat(32)}`, undefined, null, `Basic ${T}`, 'Bearer', 'Bearer '])(
    'refuses %s',
    (h) => {
      expect(check(h)).toBe(false)
    },
  )
})

describe('bearerGuard', () => {
  const guard = bearerGuard(T)
  it('allows a good header', () => {
    expect(
      guard(new Request('http://x/', { headers: { authorization: `Bearer ${T}` } })),
    ).toBeUndefined()
  })
  it('answers 401 for a bad one', () => {
    const res = guard(new Request('http://x/', { headers: { authorization: 'Bearer nope' } }))
    expect(res?.status).toBe(401)
    expect(res?.headers.get('www-authenticate')).toBe('Bearer')
  })
})

describe('readBearerToken', () => {
  it('returns undefined for unset or empty', () => {
    expect(readBearerToken({}, 'TOK')).toBeUndefined()
    expect(readBearerToken({ TOK: '' }, 'TOK')).toBeUndefined()
  })
  it('returns a good token', () => {
    expect(readBearerToken({ TOK: T }, 'TOK')).toBe(T)
  })
  it.each([` ${'a'.repeat(32)}`, `${'a'.repeat(32)}\n`, 'a'.repeat(31)])(
    'refuses a bad value without echoing it',
    (v) => {
      try {
        readBearerToken({ TOK: v }, 'TOK')
        expect.unreachable()
      } catch (e) {
        expect(e).toBeInstanceOf(GuardConfigError)
        expect((e as GuardConfigError).variable).toBe('TOK')
        expect((e as Error).message).toContain('TOK')
        expect((e as Error).message).not.toContain(v)
      }
    },
  )
  it('honours minLength and refuses one below 16', () => {
    expect(readBearerToken({ TOK: 'a'.repeat(16) }, 'TOK', { minLength: 16 })).toBe('a'.repeat(16))
    expect(() => readBearerToken({}, 'TOK', { minLength: 15 })).toThrow(GuardConfigError)
  })
})
