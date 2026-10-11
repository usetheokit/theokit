import { describe, expect, it } from 'vitest'

import LIVE_CONFIG from '../../vitest.live.config.js'

import {
  MissingProviderKeyError,
  assertProviderKeyWhenRequired,
} from '../live/require-provider-key.js'

/**
 * The live suite skipped green when no provider key was present: `test:live` printed
 * `Test Files 3 skipped (3)` and exited 0 (measured 2026-10-05, B-415). In CI that reads as a pass
 * for a job that never reached a model. Under `THEOKIT_LIVE_REQUIRED=1` an absent key must fail
 * the run instead; without the flag a developer with no key keeps the local skip.
 */
const ABSENT_MESSAGE =
  'provider key absent: THEOKIT_LIVE_REQUIRED=1 and none of OPENROUTER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, THEOKIT_API_KEY is set'

describe('assertProviderKeyWhenRequired', () => {
  it('throws a MissingProviderKeyError naming the 4 variables when required and no key is set', () => {
    const run = (): void => assertProviderKeyWhenRequired({ THEOKIT_LIVE_REQUIRED: '1' })
    expect(run).toThrow(MissingProviderKeyError)
    expect(run).toThrow(/provider key absent/)
    expect(run).toThrow(/OPENROUTER_API_KEY/)
  })

  it('treats a whitespace-only key as absent', () => {
    expect(() =>
      assertProviderKeyWhenRequired({ THEOKIT_LIVE_REQUIRED: '1', OPENROUTER_API_KEY: '   ' }),
    ).toThrow(MissingProviderKeyError)
  })

  it('returns when required and OPENROUTER_API_KEY is set', () => {
    expect(() =>
      assertProviderKeyWhenRequired({ THEOKIT_LIVE_REQUIRED: '1', OPENROUTER_API_KEY: 'present' }),
    ).not.toThrow()
  })

  it('returns when the flag is unset, even with no key', () => {
    expect(() => assertProviderKeyWhenRequired({})).not.toThrow()
  })

  it.each(['0', 'true', '', 'yes'])('returns when the flag is %j, which is not 1', (flag) => {
    expect(() => assertProviderKeyWhenRequired({ THEOKIT_LIVE_REQUIRED: flag })).not.toThrow()
  })

  it.each(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'THEOKIT_API_KEY'])(
    'returns when required and only %s holds a key',
    (name) => {
      expect(() =>
        assertProviderKeyWhenRequired({ THEOKIT_LIVE_REQUIRED: '1', [name]: 'present' }),
      ).not.toThrow()
    },
  )

  it('names variables and never values in the message', () => {
    const fakeKey = 'sk-or-v1-' + 'f'.repeat(32)
    let message = ''
    try {
      assertProviderKeyWhenRequired({
        THEOKIT_LIVE_REQUIRED: '1',
        OPENROUTER_API_KEY: '   ',
        ANTHROPIC_API_KEY: '',
        LIVE_MODEL: fakeKey,
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe(ABSENT_MESSAGE)
    expect(message).not.toContain('sk-or-v1-fff')
  })
})

// The guard only acts when the live config registers it. Without this case, deleting the
// globalSetup line would leave every test green while the CI suite step skipped green again on a
// missing key (review F-tests-1, F-wire-1).
describe('vitest.live.config.ts', () => {
  it('registers the provider-key guard as the live suite globalSetup', () => {
    expect(LIVE_CONFIG.test?.globalSetup).toEqual(['tests/live/require-provider-key.ts'])
    expect(LIVE_CONFIG.test?.include).toEqual(['tests/live/**/*.test.ts'])
  })
})
