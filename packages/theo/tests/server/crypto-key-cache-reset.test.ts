import { describe, expect, it } from 'vitest'
import { _resetKeyCacheForTests, decrypt, encrypt } from '../../src/server/auth/crypto.js'

describe('crypto key cache reset helper', () => {
  it('round-trips before and after the cache is reset', async () => {
    const secret = 'a-test-secret-that-is-long-enough-0123456789'
    const token = await encrypt({ a: 1 }, secret)
    _resetKeyCacheForTests()
    expect(await decrypt(token, secret)).toEqual({ a: 1 })
  })
})
