import { describe, it, expect } from 'vitest'

import { inspectSecret } from '../../packages/theo/src/server/auth/secret-strength.js'

/**
 * #610 — `assertProductionSecret` was wired into both constructors (#429's half of the fix) and
 * still accepted every placeholder an adopter actually writes. Its `PLACEHOLDER_PATTERN` was
 * `/CHANGE_ME|demo[-_]|placeholder/i`, so the length floor was the only condition that ever fired —
 * and a placeholder long enough to pass it is exactly what a developer produces when the error
 * message asks for 32 characters.
 *
 * The five strings below are the ones measured on the issue, verbatim. Each was ACCEPTED in
 * production by 0.64.0. A guard that is called and accepts `aaaa…` is worse than no guard: it is
 * the reason somebody stops looking.
 */
const ACCEPTED_BY_0_64_0 = [
  ['a real app fallback', 'dev-only-session-secret-32-chars-min-xxxx'],
  ['lowercase changeme', 'changemexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'],
  ['a dev prefix', 'devxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'],
  ['forty identical characters', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  ['a test secret padded with zeroes', 'test-secret00000000000000000000000000000'],
  // The OAuth-transaction fallback from the same adopter: a second call site repeating the idiom
  // of the first, which is the argument for the check living where every secret passes.
  ['the oauth-tx fallback', 'dev-only-oauth-tx-secret-32-chars-min-yy'],
] as const

describe('inspectSecret — the strings 0.64.0 accepted (#610)', () => {
  for (const [label, secret] of ACCEPTED_BY_0_64_0) {
    it(`Given ${label}, When inspected, Then it is reported weak with a reason`, () => {
      const weakness = inspectSecret(secret)
      expect(weakness, `expected "${label}" to be refused`).not.toBeNull()
      expect(weakness!.reason).toBeTruthy()
      // The reason must never echo the secret: it travels into logs and crash reports.
      expect(weakness!.reason).not.toContain(secret.slice(0, 12))
    })
  }
})

describe('inspectSecret — what it must NOT refuse', () => {
  const strong = [
    // `openssl rand -hex 32`
    '9f2c1b7ae4d05836af41c9b2e7d3105fa8b6c4e29d17035bce8a4f6027d1b93c',
    // `openssl rand -base64 32`
    'kJ8Qz1vX3pR7mN0aB5tYc2WgH6uL9sD4eF1iO8rT7yU=',
    // A passphrase a human might legitimately choose: long, varied, no placeholder vocabulary.
    'purple-canyon-lantern-47-orbit-sandwich',
  ]

  for (const secret of strong) {
    it(`Given a strong secret, When inspected, Then it passes: ${secret.slice(0, 12)}…`, () => {
      expect(inspectSecret(secret)).toBeNull()
    })
  }
})

describe('inspectSecret — each rule reports which one fired', () => {
  it('Given a short secret, Then the code is too_short', () => {
    expect(inspectSecret('short')?.code).toBe('too_short')
  })

  it('Given placeholder vocabulary, Then the code is placeholder', () => {
    expect(inspectSecret('CHANGE_ME_TO_RANDOM_32_PLUS_CHARS_FOR_REAL')?.code).toBe('placeholder')
  })

  it('Given too few distinct characters, Then the code is low_variety', () => {
    // 40 chars, no placeholder word, only 4 distinct characters.
    expect(inspectSecret('abcabcabcabcabcabcabcabcabcabcabcabcabca')?.code).toBe('low_variety')
  })

  it('Given a long enough secret with variety, Then no rule fires', () => {
    expect(inspectSecret('9f2c1b7ae4d05836af41c9b2e7d3105fa8b6c4e2')).toBeNull()
  })

  // The length floor speaks first: a short placeholder keeps the message it has always had.
  it('Given a short placeholder, Then too_short wins over placeholder', () => {
    expect(inspectSecret('CHANGE_ME')?.code).toBe('too_short')
  })
})
