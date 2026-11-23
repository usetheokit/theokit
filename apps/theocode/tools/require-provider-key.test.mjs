/**
 * The guard `npm run test:live` loads as its globalSetup (B-407, B-415).
 *
 * The A2A real-model test skips when no provider key is set, which is right on a developer machine
 * and wrong in the live-model CI job: there it skipped green on every push, because the only job
 * that ran it held no key. Under `THEOKIT_LIVE_REQUIRED=1` an absent key must fail the run with its
 * reason; without the flag the local skip stays.
 */
import { describe, expect, it } from 'vitest'

import { MissingProviderKeyError, assertProviderKeyWhenRequired } from './require-provider-key.mjs'

const ABSENT_MESSAGE =
  'provider key absent: THEOKIT_LIVE_REQUIRED=1 and none of OPENROUTER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, THEOKIT_API_KEY is set'

describe('assertProviderKeyWhenRequired', () => {
  it('throws MissingProviderKeyError naming the four variables when required and no key is set', () => {
    expect(() => assertProviderKeyWhenRequired({ THEOKIT_LIVE_REQUIRED: '1' })).toThrow(
      new MissingProviderKeyError([
        'OPENROUTER_API_KEY',
        'ANTHROPIC_API_KEY',
        'OPENAI_API_KEY',
        'THEOKIT_API_KEY',
      ]),
    )
  })

  it('treats a whitespace-only key as absent', () => {
    expect(() =>
      assertProviderKeyWhenRequired({ THEOKIT_LIVE_REQUIRED: '1', OPENROUTER_API_KEY: '   ' }),
    ).toThrow(MissingProviderKeyError)
  })

  it('returns when required and a key is set', () => {
    expect(() =>
      assertProviderKeyWhenRequired({ THEOKIT_LIVE_REQUIRED: '1', OPENROUTER_API_KEY: 'present' }),
    ).not.toThrow()
  })

  it('returns when the flag is unset, so a machine with no key keeps the local skip', () => {
    expect(() => assertProviderKeyWhenRequired({})).not.toThrow()
  })

  it('names variables and never values in the message', () => {
    const fakeKey = 'sk-or-v1-' + 'f'.repeat(32)
    let message = ''
    try {
      assertProviderKeyWhenRequired({ THEOKIT_LIVE_REQUIRED: '1', LIVE_MODEL: fakeKey })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toBe(ABSENT_MESSAGE)
    expect(message).not.toContain('sk-or-v1-fff')
  })
})
