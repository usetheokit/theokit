/**
 * Finding #45 — the six transitions of the consent state model, all at 0% line coverage.
 *
 * `consent-state.ts` is the reducer behind `useConsent`, and nothing in the tree named it: four
 * files in `src/consent/` had a test and three did not. It is not an accepted exclusion — it is a
 * gap — and the state it holds decides two things a user meets: whether the trust gate is open,
 * and which hooks the consent screen is still going to ask about.
 *
 * ## What `epoch` is, and why the asymmetry the finding names is correct
 *
 * The finding records one unasserted asymmetry: `trust()` bumps `epoch` and `distrust()` does not.
 * Read against the consumer, that is deliberate, and the tests below encode the reason rather than
 * "fixing" it.
 *
 * `epoch` is not a generation counter for the state — it is the invalidation key of ONE memo.
 * `use-consent.ts:42-53` computes `pendingHooks` under `useMemo(..., [cwd, declined, epoch])`, and
 * that computation reads two things OFF DISK: the effective config (whose project layer is gated by
 * the trust posture) and the hook-approval store. So the rule is:
 *
 *   **`epoch` bumps exactly when a WRITE to one of those two on-disk inputs has happened.**
 *
 *   `trust()`             `ConsentGates.tsx:93` persists trust with `trustDir(cwd)`; the project
 *                         config layer may now be honoured -> re-read.       bump
 *   `persistedApproval()` `use-consent.ts:59` runs it only after `approveHook` resolved, so the
 *                         approval store on disk just changed.               bump
 *   `distrust()`          its only caller is the REJECTION handler of that same `trustDir` call
 *                         (`ConsentGates.tsx:114`) — the persist FAILED, so nothing on disk moved
 *                         and there is nothing to re-read.                   no bump
 *   `refuseHook()`        writes nothing; `declined` is itself a memo dep, so the filter re-runs.
 *   `markReviewed()`      writes nothing.
 *
 * `trusted` is a render flag, not an input to that read — which is why flipping it is not, on its
 * own, a reason to bump. The invariant that WOULD break this is named in the test below: if
 * `distrust()` ever became reachable from a path that revoked ALREADY-PERSISTED trust, the disk
 * would have changed and the bump would be required.
 */
import { describe, expect, it } from 'vitest'

import {
  distrust,
  initialState,
  markReviewed,
  persistedApproval,
  refuseHook,
  trust,
  type ConsentState,
} from '../../src/consent/consent-state.js'

describe('the consent state model', () => {
  it('test_distrust_clears_trust_that_was_granted', () => {
    // Anti-vacuity floor, and the one whose direction matters: `distrust()` is the rollback run
    // when persisting trust FAILED. A no-op here — or an inverted one — leaves the session
    // believing a directory is trusted that the store never recorded, which is the fail-OPEN
    // direction on the gate that governs reading files and running commands. Every assertion
    // below this one would still pass if `distrust` returned its argument unchanged.
    const granted = trust(initialState(false))
    expect(granted.trusted, 'the fixture must actually be trusted first').toBe(true)

    expect(distrust(granted).trusted, 'a failed trust persist left the session trusted').toBe(false)
  })

  it('test_initial_state_carries_the_posture_it_was_given', () => {
    expect(initialState(true).trusted).toBe(true)
    expect(initialState(false).trusted).toBe(false)
  })

  it('test_initial_state_starts_unreviewed_with_nothing_declined_at_epoch_zero', () => {
    const state = initialState(true)

    // An already-trusted directory still has its hooks reviewed: directory trust and hook approval
    // are separate decisions, and starting `hooksReviewed: true` here would close the hook gate
    // for anyone whose directory was trusted on a previous run.
    expect(state.hooksReviewed).toBe(false)
    expect([...state.declined]).toEqual([])
    expect(state.epoch).toBe(0)
  })

  it('test_trust_bumps_the_epoch_so_the_pending_hooks_are_re_read', () => {
    // Trust is persisted before this runs, and the project config layer is gated by the posture:
    // hooks that were invisible while the directory was untrusted can appear. Without the bump the
    // memo keeps the list computed under the old posture and the user is never asked about them.
    expect(trust(initialState(false)).epoch).toBe(1)
    expect(trust(trust(initialState(false))).epoch).toBe(2)
  })

  it('test_distrust_leaves_the_epoch_alone_because_nothing_was_written', () => {
    const granted = trust(initialState(false))

    // The asymmetry finding #45 names, asserted with its reason: `distrust()` is reached only when
    // `trustDir` REJECTED, so the trust store is exactly as it was and re-reading it would produce
    // the list already held. This assertion is the guard on that premise — if `distrust()` ever
    // gains a caller that revokes persisted trust, the disk WILL have changed, this test goes red,
    // and the bump belongs in `distrust` at that point.
    expect(distrust(granted).epoch).toBe(granted.epoch)
  })

  it('test_persisted_approval_bumps_the_epoch_and_changes_nothing_else', () => {
    const state = refuseHook(markReviewed(initialState(true)), 'aa')

    const after = persistedApproval(state)

    // Runs only after `approveHook` resolved, so the approval store on disk has changed and the
    // approved hook must drop out of the pending list on the next render.
    expect(after.epoch).toBe(state.epoch + 1)
    expect(after.trusted).toBe(state.trusted)
    expect(after.hooksReviewed).toBe(state.hooksReviewed)
    expect([...after.declined]).toEqual(['aa'])
  })

  it('test_refuse_hook_records_the_fingerprint_without_bumping_the_epoch', () => {
    const after = refuseHook(initialState(true), 'ff00')

    expect([...after.declined]).toEqual(['ff00'])
    // Refusing writes nothing; `declined` is a memo dependency in its own right, so the pending
    // list re-filters without the counter moving.
    expect(after.epoch).toBe(0)
  })

  it('test_refuse_hook_keeps_the_fingerprints_already_declined', () => {
    const after = refuseHook(refuseHook(initialState(true), 'aa'), 'bb')

    // Each refusal must ACCUMULATE. Replacing the set would let a hook the user already declined
    // reappear in the pending list on the next recompute and be asked about again.
    expect([...after.declined].sort()).toEqual(['aa', 'bb'])
  })

  it('test_mark_reviewed_closes_the_hook_gate_without_bumping_the_epoch', () => {
    const after = markReviewed(initialState(false))

    expect(after.hooksReviewed).toBe(true)
    expect(after.trusted, 'reviewing hooks is not granting directory trust').toBe(false)
    expect(after.epoch).toBe(0)
  })

  it('test_every_transition_returns_a_new_state_and_leaves_its_input_untouched', () => {
    const before = initialState(false)
    const snapshot = { ...before, declined: new Set(before.declined) }

    const results: ConsentState[] = [
      trust(before),
      distrust(before),
      refuseHook(before, 'aa'),
      persistedApproval(before),
      markReviewed(before),
    ]

    // These are `setState` reducers. A transition that mutated in place would hand React the SAME
    // object — no re-render — and `refuseHook` mutating `declined` in place would additionally keep
    // the memo's dependency reference-equal, so the pending list would never re-filter and the
    // declined hook would keep being asked about.
    for (const after of results) expect(after).not.toBe(before)
    expect(before).toEqual(snapshot)
    expect([...before.declined]).toEqual([])
  })
})
