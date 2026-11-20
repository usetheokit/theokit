import { describe, expect, it } from 'vitest'

import {
  LIVE_KEY_NAMES,
  MissingProviderKeyError,
  assertProviderKeyWhenRequired,
  requireProviderKeySetup,
} from '../../src/testing/index.js'

describe('provider-key guard options', () => {
  it('a custom names list is honoured', () => {
    const env = { THEOKIT_LIVE_REQUIRED: '1', OPENROUTER_API_KEY: 'x' }
    expect(() => assertProviderKeyWhenRequired(env, { names: ['MY_KEY'] })).toThrow(
      MissingProviderKeyError,
    )
    expect(() =>
      assertProviderKeyWhenRequired({ ...env, MY_KEY: 'y' }, { names: ['MY_KEY'] }),
    ).not.toThrow()
  })

  it('a custom requiredFlag is honoured', () => {
    const opts = { requiredFlag: 'THEOCLAW_LIVE' }
    expect(() => assertProviderKeyWhenRequired({ THEOKIT_LIVE_REQUIRED: '1' }, opts)).not.toThrow()
    expect(() => assertProviderKeyWhenRequired({ THEOCLAW_LIVE: '1' }, opts)).toThrow(
      /THEOCLAW_LIVE=1/,
    )
  })

  it('the error message names the variables and never a value', () => {
    const sentinel = 'sk-sentinel-do-not-print'
    let error: unknown
    try {
      assertProviderKeyWhenRequired({ THEOKIT_LIVE_REQUIRED: '1', UNRELATED_SECRET: sentinel })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(MissingProviderKeyError)
    expect(error).toBeInstanceOf(Error)
    const message = (error as MissingProviderKeyError).message
    for (const name of LIVE_KEY_NAMES) expect(message).toContain(name)
    expect(message).not.toContain(sentinel)
    expect((error as MissingProviderKeyError).code).toBe('missing_provider_key')
  })

  it('a whitespace-only key counts as absent', () => {
    expect(() =>
      assertProviderKeyWhenRequired(
        { THEOKIT_LIVE_REQUIRED: '1', MY_KEY: '  \t' },
        { names: ['MY_KEY'] },
      ),
    ).toThrow(MissingProviderKeyError)
  })

  it('requireProviderKeySetup reads process.env at call time', () => {
    const setup = requireProviderKeySetup({ requiredFlag: 'PK_TEST_FLAG', names: ['PK_TEST_KEY'] })
    delete process.env.PK_TEST_KEY
    process.env.PK_TEST_FLAG = '1'
    try {
      expect(setup).toThrow(MissingProviderKeyError)
      process.env.PK_TEST_KEY = 'v'
      expect(setup).not.toThrow()
    } finally {
      delete process.env.PK_TEST_FLAG
      delete process.env.PK_TEST_KEY
    }
  })
})
