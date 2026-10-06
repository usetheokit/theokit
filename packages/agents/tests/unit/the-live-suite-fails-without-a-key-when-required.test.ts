import { describe, expect, it } from 'vitest'

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

  it('returns when the flag is 0', () => {
    expect(() => assertProviderKeyWhenRequired({ THEOKIT_LIVE_REQUIRED: '0' })).not.toThrow()
  })

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
