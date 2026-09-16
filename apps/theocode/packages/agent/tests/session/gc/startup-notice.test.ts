/**
 * What the operator is told when the background sweep does NOT start.
 *
 * The rule lived inline in `tui/src/main.tsx`, a file at 0% coverage, as a three-clause condition
 * nobody could exercise: report unless the reason is `too-soon` or `disabled`. Both of those are
 * NORMAL — the sweep runs at most once a day and can be turned off — so reporting them would put a
 * line in the log on nearly every launch, and a channel that always says something is one nobody
 * reads. Anything else is abnormal and must be visible, because the alternative is a collector that
 * silently never collects, which is the failure B-138 was.
 *
 * Extracted here rather than tested in place: it belongs beside `sweepFinishedLine`, for the same
 * reason that one is separate — "what the operator is told about the sweep" is one concern, and it
 * should not be split across a package boundary.
 */
import { describe, expect, it } from 'vitest'

import { startupNoticeFor } from '../../../src/session/gc/auto-runtime.js'

describe('startupNoticeFor', () => {
  it('test_a_started_sweep_says_nothing', () => {
    expect(startupNoticeFor({ started: true, reason: 'applying' })).toBeUndefined()
  })

  it('test_the_daily_interval_is_not_worth_a_line', () => {
    expect(startupNoticeFor({ started: false, reason: 'too-soon' })).toBeUndefined()
  })

  it('test_being_switched_off_is_not_worth_a_line', () => {
    expect(startupNoticeFor({ started: false, reason: 'disabled' })).toBeUndefined()
  })

  it('test_an_unspawnable_sweep_is_reported', () => {
    // The case that matters: the child could not be built, so collection will never happen, and
    // without this line the operator sees a product that quietly stopped collecting.
    expect(startupNoticeFor({ started: false, reason: 'unspawnable' })).toContain('unspawnable')
  })

  it('test_a_failed_spawn_is_reported', () => {
    expect(startupNoticeFor({ started: false, reason: 'spawn-failed' })).toContain('spawn-failed')
  })

  it('test_the_notice_names_the_subsystem', () => {
    // stderr carries every subsystem's diagnostics; a bare reason would not say whose it is.
    expect(startupNoticeFor({ started: false, reason: 'spawn-failed' })).toContain('[sessions gc]')
  })
})
