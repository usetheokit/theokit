/**
 * T4.1 — `delegation/` shipped 6 source files and zero tests.
 *
 * That mattered more than usual on 2026-08-09: the English-only pass renamed five identifiers
 * inside this module (`trabalho` -> `work`, `dormir` -> `sleep`, `selecao` -> `selection`,
 * `efforto` -> `selectedEffort`, `hooksParaMembro` -> `hooksForMember`) and the only thing standing
 * behind those renames was `tsc`. A typechecker proves the code still compiles; it does not prove
 * it still behaves.
 *
 * Delegation is a trust boundary — it decides how long a delegated run may hold the agent and what
 * happens to the work when it does not finish. A silent regression here strands a session.
 *
 * Caps are 1 ms or an hour, so no test waits on the wall clock.
 */
import { describe, expect, it } from 'vitest'

import { DELEGATION_CAP_MS, runTeamWithCap } from '../../src/delegation/squad.js'

/** The cap moved into the framework's `withClockCap`; `runTeamWithCap` is TheoCode's seam over it. */
const withDelegationCap = <T>(work: Promise<T>, capMs: number): Promise<T> =>
  runTeamWithCap(
    [],
    () => work,
    () => {},
    capMs,
  )

describe('T4.1 — a delegated run is abandoned when its cap elapses', () => {
  it('test_work_that_outlives_the_cap_is_abandoned', async () => {
    const stuck = new Promise<string>(() => {}) // never settles

    await expect(withDelegationCap(stuck, 1)).rejects.toThrow(/delegation_timeout/)
  })

  it('test_work_completing_before_the_cap_returns_its_value', async () => {
    // ANTI-VACUITY FLOOR: rejecting everything would satisfy the assertion above, and would mean
    // no delegation could ever succeed.
    await expect(withDelegationCap(Promise.resolve('done'), 3_600_000)).resolves.toBe('done')
  })

  it('test_the_abandonment_error_says_the_work_on_disk_was_not_reverted', async () => {
    // The message is the whole recovery instruction the operator gets. A delegation that was
    // abandoned may have written files, and the error is the only place that is said.
    const stuck = new Promise<string>(() => {})

    await expect(withDelegationCap(stuck, 1)).rejects.toThrow(/NOT reverted/)
  })

  it('test_a_rejecting_work_promise_surfaces_its_own_error_not_the_cap', async () => {
    // NEGATIVE CASE: the delegated work failing is different from the delegation timing out, and
    // collapsing them would send the operator to inspect a tree for a failure that never wrote to it.
    const boom = Promise.reject(new Error('the member agent crashed'))

    await expect(withDelegationCap(boom, 3_600_000)).rejects.toThrow('the member agent crashed')
  })

  it('test_the_default_cap_is_the_exported_constant', () => {
    // The default is a real budget, not a placeholder: 15 minutes.
    expect(DELEGATION_CAP_MS).toBe(15 * 60_000)
  })
})
