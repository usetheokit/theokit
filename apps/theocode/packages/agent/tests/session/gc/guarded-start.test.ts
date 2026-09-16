/**
 * Housekeeping must not take the terminal down — a README guarantee with no test.
 *
 * `resolveEffectiveConfig` THROWS on a malformed `~/.theocode/config.toml`, and it is evaluated
 * while the sweep's argument object is built: before any promise exists, so a `.catch` could never
 * have seen it. The wrapping try/catch lived in `main.tsx` at 0% coverage, which means the one
 * guarantee protecting a user with a typo in their config was asserted in prose and nowhere else.
 *
 * The failure it prevents is not subtle: `render()` has already claimed the terminal by then, so an
 * escaping throw kills the UI after it is drawn.
 */
import { describe, expect, it } from 'vitest'

import { guardedSweepStart } from '../../../src/session/gc/guarded-start.js'

const ok = () => ({ started: true, reason: 'applying' })

describe('guardedSweepStart', () => {
  it('test_a_config_that_throws_does_not_reach_the_caller', () => {
    const said: string[] = []

    expect(() =>
      guardedSweepStart({
        enabled: () => {
          throw new Error('config.toml: unexpected character at line 3')
        },
        onReport: (l) => said.push(l),
        start: ok,
      }),
    ).not.toThrow()
  })

  it('test_the_reason_the_config_could_not_be_read_is_reported', () => {
    // Skipping silently would leave the operator with a collector that never runs and no way to
    // learn why — the silent non-collection of B-138, reached through a different door.
    const said: string[] = []

    guardedSweepStart({
      enabled: () => {
        throw new Error('config.toml: unexpected character at line 3')
      },
      onReport: (l) => said.push(l),
      start: ok,
    })

    expect(said.join(' ')).toContain('skipped')
    expect(said.join(' '), 'the operator is told it was skipped but not why').toContain('line 3')
  })

  it('test_a_non_error_throw_still_produces_a_readable_line', () => {
    // A thrown string has no `.message`; reporting `[object Object]` or `undefined` would be a
    // report in name only.
    const said: string[] = []

    guardedSweepStart({
      enabled: () => {
        throw 'plain string'
      },
      onReport: (l) => said.push(l),
      start: ok,
    })

    expect(said.join(' ')).toContain('plain string')
  })

  it('test_a_healthy_start_reports_no_skip', () => {
    // Anti-vacuity: a function that always reported "skipped" would satisfy the cases above.
    const said: string[] = []

    guardedSweepStart({ enabled: () => true, onReport: (l) => said.push(l), start: ok })

    expect(said.join(' ')).not.toContain('skipped')
  })

  it('test_the_enabled_flag_reaches_the_sweep', () => {
    // The reader is a FUNCTION so it is called inside the guard. Reading it outside would put the
    // throw back where nothing catches it, which is the bug this exists to prevent.
    let seen: boolean | undefined

    guardedSweepStart({
      enabled: () => false,
      onReport: () => {},
      start: (o) => {
        seen = o.enabled
        return { started: false, reason: 'disabled' }
      },
    })

    expect(seen).toBe(false)
  })

  it('test_a_non_started_sweep_still_reports_its_reason', () => {
    const said: string[] = []

    guardedSweepStart({
      enabled: () => true,
      onReport: (l) => said.push(l),
      start: () => ({ started: false, reason: 'unspawnable' }),
    })

    expect(said.join(' ')).toContain('unspawnable')
  })
})
