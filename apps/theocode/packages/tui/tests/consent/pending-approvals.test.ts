/**
 * B-011 — is the local approval ledger load-bearing, or does `findPendingApproval` cover it?
 *
 * The review could not settle this: it depends on how quickly the SDK mutates `thread` after
 * `approve()`, which static reading cannot answer. So this measures the difference instead.
 *
 * `findPendingApproval(messages)` is STATELESS — it derives the answer from the thread on every
 * call. The ledger is STATEFUL: it records that an approval was settled locally. The two only differ
 * in one window, and it is the window that matters — between the user answering and the SDK's thread
 * reflecting it. A stateless derivation re-reports the same approval during that window, because the
 * thread still shows it pending.
 *
 * What that costs a user: the approval card they just dismissed reappears, and a second answer is
 * sent for an approval already answered.
 *
 * The tests below pin that behaviour. If a future version of the SDK settles the thread
 * synchronously, `test_a_settled_approval_is_not_offered_again` still passes with the ledger
 * removed — and that is the signal that this file can go.
 */
import { describe, expect, it } from 'vitest'

import { createApprovalLedger, findNextApproval, ingest, prune, settle } from '@theokit/tui'

/** One assistant message carrying a part in the `approval-requested` state. */
const pendingThread = (id: string): Parameters<typeof ingest>[1] => [
  {
    id: 'm1',
    role: 'assistant',
    parts: [
      { type: 'tool-Bash', state: 'approval-requested', toolCallId: id, toolName: 'Bash', input: {} },
    ],
  },
]

describe('B-011 — the ledger is load-bearing while the thread lags', () => {
  it('test_a_pending_approval_is_offered', () => {
    // Anti-vacuity floor: if nothing were ever offered, everything below passes for free.
    const ledger = ingest(createApprovalLedger(), pendingThread('call-1'))

    expect(findNextApproval(ledger)?.approvalId).toBe('call-1')
  })

  it('test_a_settled_approval_is_not_offered_again_while_the_thread_still_shows_it', () => {
    const thread = pendingThread('call-1')
    let ledger = ingest(createApprovalLedger(), thread)

    ledger = settle(ledger, 'call-1')
    // The SDK has not mutated the thread yet — this is the exact window in question.
    ledger = ingest(ledger, thread)

    expect(
      findNextApproval(ledger),
      'the approval the user just answered was offered again, because the thread still showed it ' +
        'pending. This is what the ledger exists to prevent, and what a stateless re-derivation ' +
        'from the thread cannot.',
    ).toBeUndefined()
  })

  it('test_a_second_distinct_approval_is_still_offered_after_the_first_settles', () => {
    // The ledger must suppress the ANSWERED one, not stop offering approvals altogether.
    let ledger = ingest(createApprovalLedger(), pendingThread('call-1'))
    ledger = settle(ledger, 'call-1')

    ledger = ingest(ledger, pendingThread('call-2'))

    expect(findNextApproval(ledger)?.approvalId).toBe('call-2')
  })

  it('test_a_backtrack_that_cuts_the_thread_drops_its_approvals', () => {
    // `use-approvals.ts` prunes before it ingests; the toolkit ledger does not do it on its own.
    let ledger = ingest(createApprovalLedger(), pendingThread('call-1'))

    ledger = ingest(prune(ledger, 0), [])

    expect(findNextApproval(ledger)).toBeUndefined()
  })
})
