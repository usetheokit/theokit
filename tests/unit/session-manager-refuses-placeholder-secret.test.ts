import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  createSessionManager,
  createSessionManagerWeb,
} from '../../packages/theo/src/server/auth/session.js'

/**
 * #429 — `assertProductionSecret` was exported, thoroughly unit-tested, and never called.
 *
 * The unit tests proved the function works. Nothing proved it runs, and it did not: both session
 * managers validated their secret through `normalizeSecrets`, which enforces a 32-character floor
 * in every environment and knows nothing about placeholders. So a 32+ character `CHANGE_ME…`
 * booted in production — while the dev-time warning promising that production "will REFUSE to
 * boot" sat inside the function nobody called, invisible to the developer it was written for.
 *
 * These tests exercise the constructors a real application calls, not the guard directly. A guard
 * with a passing unit test and no caller is the shape of defect this file exists to prevent from
 * recurring.
 */

// 41 chars, so the length floor cannot be what refuses it. It is the placeholder that must.
const LONG_PLACEHOLDER = 'CHANGE_ME_TO_RANDOM_32_PLUS_CHARS_FOR_REAL'
const REAL_SECRET = 'a-real-32-char-or-more-secret-value-for-tests'

const constructors = [
  ['createSessionManager', createSessionManager],
  ['createSessionManagerWeb', createSessionManagerWeb],
] as const

describe('session managers refuse a placeholder secret in production (#429)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    warnSpy.mockRestore()
  })

  for (const [name, construct] of constructors) {
    it(`Given production, When ${name} gets a long placeholder, Then it refuses to build`, () => {
      vi.stubEnv('NODE_ENV', 'production')
      expect(LONG_PLACEHOLDER.length).toBeGreaterThanOrEqual(32)

      expect(() => construct({ secret: LONG_PLACEHOLDER, cookieName: 'sid' })).toThrow(
        /placeholder/i,
      )
    })

    it(`Given production, When ${name} gets a real secret, Then it builds`, () => {
      vi.stubEnv('NODE_ENV', 'production')
      expect(() => construct({ secret: REAL_SECRET, cookieName: 'sid' })).not.toThrow()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    // The refusal is production-only, and development is where the warning has to reach a human —
    // it is the sentence that tells them production will refuse. It was unreachable before.
    it(`Given development, When ${name} gets a long placeholder, Then it builds and warns`, () => {
      vi.stubEnv('NODE_ENV', 'development')
      expect(() => construct({ secret: LONG_PLACEHOLDER, cookieName: 'sid' })).not.toThrow()
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(String(warnSpy.mock.calls[0][0])).toMatch(/REFUSE to boot/i)
    })

    // A single bad entry in a rotation array must refuse, with the index named.
    it(`Given production, When ${name} gets an array with one placeholder, Then it refuses`, () => {
      vi.stubEnv('NODE_ENV', 'production')
      expect(() =>
        construct({ secret: [REAL_SECRET, LONG_PLACEHOLDER], cookieName: 'sid' }),
      ).toThrow(/index 1/i)
    })

    // Unchanged: the length floor still speaks first, with the message it always used.
    it(`Given a short secret, When ${name} is called, Then the existing message is unchanged`, () => {
      vi.stubEnv('NODE_ENV', 'production')
      expect(() => construct({ secret: 'too-short', cookieName: 'sid' })).toThrow(
        /at least 32 characters/i,
      )
    })
  }
})
