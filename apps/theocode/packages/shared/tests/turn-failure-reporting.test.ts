/**
 * The composition B-130 actually depends on, which nothing exercised.
 *
 * `createRetryRecord` is at 100% and `turnErrorText` is at 100%, and neither proves the thing the
 * user sees. The count only reaches the message if the record's `sink` is wired to the stream AND
 * `attempts()` is read at error time — two arguments to the same options object, a hundred lines
 * into `commands/run.ts`, on a path no test reaches (the file sits at 9.8%).
 *
 * Drop `onRunEvent: retries.sink` and every unit test still passes while `attempts()` returns 0
 * forever, so "after 3 attempts" silently never appears again — which is exactly the failure B-130
 * was built to fix. That is pillar (b) of the wiring triad: the unit tests mock the boundary, and
 * this covers the boundary they mocked.
 */
import { describe, expect, it } from 'vitest'

import { turnFailureReporting } from '../src/turn-failure-reporting.js'

const rateLimit = (attempt: number) => ({ type: 'rate_limit' as const, attempt })

describe('turnFailureReporting', () => {
  it('test_the_retry_count_reaches_the_message_the_user_reads', () => {
    const hooks = turnFailureReporting({ diagnosticsEnabled: () => true })

    hooks.onRunEvent(rateLimit(1))
    hooks.onRunEvent(rateLimit(3))

    expect(hooks.onError({ message: 'upstream refused' })).toContain('after 3 attempts')
  })

  it('test_a_turn_that_never_retried_says_nothing_about_attempts', () => {
    const hooks = turnFailureReporting({ diagnosticsEnabled: () => true })

    expect(hooks.onError({ message: 'upstream refused' })).not.toContain('attempt')
  })

  it('test_the_provider_message_survives_the_wrapping', () => {
    // Anti-vacuity: hooks that returned only the suffix would satisfy the assertion above.
    const hooks = turnFailureReporting({ diagnosticsEnabled: () => true })

    expect(hooks.onError({ message: 'upstream refused' })).toContain('upstream refused')
  })

  it('test_diagnostics_being_off_adds_the_hint_and_being_on_does_not', () => {
    const off = turnFailureReporting({ diagnosticsEnabled: () => false })
    const on = turnFailureReporting({ diagnosticsEnabled: () => true })

    expect(off.onError({ message: 'x' })).toContain('THEOCODE_DIAGNOSTICS')
    expect(on.onError({ message: 'x' })).not.toContain('THEOCODE_DIAGNOSTICS')
  })

  it('test_diagnostics_are_read_at_failure_time_not_at_wiring_time', () => {
    // The flag is a function rather than a boolean on purpose: the sink is installed before the
    // turn starts, and reading it once at construction would report the state of the wrong moment.
    let enabled = true
    const hooks = turnFailureReporting({ diagnosticsEnabled: () => enabled })
    enabled = false

    expect(hooks.onError({ message: 'x' })).toContain('THEOCODE_DIAGNOSTICS')
  })

  it('test_a_new_turn_clears_a_count_from_the_previous_one', () => {
    // A stale count is worse than an absent one: it attributes another turn's retries to this
    // failure. `startTurn` exists for this and is wired here so a caller cannot forget it.
    const hooks = turnFailureReporting({ diagnosticsEnabled: () => true })
    hooks.onRunEvent(rateLimit(3))
    hooks.startTurn()

    expect(hooks.onError({ message: 'x' })).not.toContain('attempt')
  })
})
