/**
 * The anti-vacuity rule, tested directly.
 *
 * It existed before as an `it` inside a `describe` at the TOP of `crossval-gaps.test.ts`, with a
 * comment asserting it "runs last by declaration order so `skipped` is populated". The meta block is
 * declared ~30 lines above the first gap block, so it ran 2nd of 33 against an empty list: a run in
 * which every gap assertion skipped still reported 33 passed. The guard against a vacuous pass was
 * itself vacuous, and it could only be checked by reasoning about where it sat in a file.
 *
 * Extracting the rule makes the check a fact rather than an argument. It now runs from `afterAll`,
 * which does not depend on declaration order at all.
 */
import { describe, expect, it } from 'vitest'

import { refuseMostlySkipped } from '../lib/refuse-mostly-skipped.js'

const entry = (gap: string) => ({ gap, reason: 'dist unbuilt' })

describe('refuseMostlySkipped', () => {
  it('test_many_skips_under_ci_are_refused', () => {
    expect(() => {
      refuseMostlySkipped([entry('G1'), entry('G2'), entry('G3')], true)
    }).toThrow(/vacuous pass/)
  })

  it('test_the_message_names_how_many_and_which', () => {
    // An operator reading CI needs to know WHICH gaps went unverified, not merely that some did.
    try {
      refuseMostlySkipped([entry('G4'), entry('G5')], true)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as Error).message).toContain('2')
      expect((error as Error).message).toContain('G4')
      expect((error as Error).message).toContain('G5')
    }
  })

  it('test_one_skip_is_tolerated', () => {
    // The designed allowance: one unbuilt artifact skips one gap, and failing on that would train
    // people to ignore the suite.
    expect(() => {
      refuseMostlySkipped([entry('G1')], true)
    }).not.toThrow()
  })

  it('test_no_skips_is_never_a_failure', () => {
    expect(() => {
      refuseMostlySkipped([], true)
    }).not.toThrow()
  })

  it('test_outside_ci_nothing_is_refused', () => {
    // Locally an unbuilt `dist/` is an ordinary state.
    expect(() => {
      refuseMostlySkipped([entry('G1'), entry('G2'), entry('G3')], false)
    }).not.toThrow()
  })
})
