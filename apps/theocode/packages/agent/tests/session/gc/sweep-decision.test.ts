/**
 * The decision the two sweeps share: enabled, due, and first.
 *
 * It was extracted when the sweep moved to a child process (B-142) and there were briefly two
 * callers. The in-process form is gone now, but the decision keeps its own tests because it carries
 * B-139's look-first property — the first sweep must not apply — and that is the one property most
 * easily lost in a redesign.
 */
import { describe, expect, it } from 'vitest'

import { sweepDecision } from '../../../src/session/gc/auto.js'

const NOW = new Date('2026-09-03T12:00:00Z')
const decide = (over: Partial<Parameters<typeof sweepDecision>[0]> = {}) =>
  sweepDecision({ enabled: true, now: NOW, intervalHours: 24, lastRun: undefined, ...over })

describe('sweepDecision', () => {
  it('test_a_disabled_collector_does_not_run', () => {
    expect(decide({ enabled: false })).toEqual({ run: false, reason: 'disabled' })
  })

  it('test_it_runs_when_it_has_never_run_before_and_says_so', () => {
    // `firstRun` is what makes the child dry-run (B-139).
    expect(decide()).toEqual({ run: true, firstRun: true })
  })

  it('test_it_stays_quiet_inside_the_interval', () => {
    const lastRun = new Date(NOW.getTime() - 60 * 60 * 1000)
    expect(decide({ lastRun })).toEqual({ run: false, reason: 'too-soon', lastRun })
  })

  it('test_it_runs_again_once_the_interval_elapsed_and_is_no_longer_first', () => {
    // Anti-vacuity: always reporting `firstRun: true` would keep the collector dry-running forever,
    // which is the failure B-138 was about.
    const lastRun = new Date(NOW.getTime() - 25 * 60 * 60 * 1000)
    expect(decide({ lastRun })).toEqual({ run: true, firstRun: false })
  })

  it('test_an_unusable_stamp_is_treated_as_no_stamp_in_BOTH_answers', () => {
    // A corrupt stamp must not disable collection forever — sweeping is the recoverable direction.
    // But it must also not read as "a previous run happened", which would skip the look-first dry
    // run and apply straight away. That is the unsafe direction on the one path that deletes user
    // data, and it is what this returned before the check was moved.
    expect(decide({ lastRun: new Date(Number.NaN) })).toEqual({ run: true, firstRun: true })
  })
})
