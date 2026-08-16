/**
 * T2.7 — the ledger gains the slot that was keeping it unadopted.
 *
 * `createPendingLedger` ships and the only real surface does not use it: it keeps
 * `packages/tui/src/consent/pending-approvals.ts` instead. The measured reason is shape, not
 * quality — the ledger remembers THAT a decision is pending, and a surface also needs to hang its
 * own render state off the same item. Without a slot, adopting means maintaining a second map keyed
 * by the same id, which is strictly worse than the one map it already has.
 *
 * A primitive that ships and is not adopted is the pattern this whole plan exists to break, and the
 * fix is one type parameter with a default so no existing call site changes.
 */
import { describe, expect, expectTypeOf, it } from 'vitest'

import { createPendingLedger, type PendingItem } from '../../src/ask/pending-ledger.js'

interface RenderState {
  renderedAt: number
  collapsed: boolean
}

describe('createPendingLedger — a surface can keep its own state on the item', () => {
  it('test_a_payload_round_trips_on_a_pending_item', () => {
    const ledger = createPendingLedger<RenderState>()
    ledger.ingest([{ id: 'a1', messageIndex: 3, payload: { renderedAt: 111, collapsed: false } }])
    const next = ledger.findNext()
    expect(next?.payload).toEqual({ renderedAt: 111, collapsed: false })
  })

  it('test_the_framework_never_reads_the_payload', () => {
    // The slot is opaque. A payload that throws on property access must not break ingest, settle,
    // findNext or pruneBefore — if any of them read it, it stops being the surface's own space.
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('the framework read the payload')
        },
      },
    ) as RenderState

    const ledger = createPendingLedger<RenderState>()
    expect(() => {
      ledger.ingest([{ id: 'a1', messageIndex: 1, payload: hostile }])
      ledger.findNext()
      ledger.pruneBefore(0)
      ledger.settle('a1')
    }).not.toThrow()
  })

  it('test_existing_call_sites_compile_without_a_type_argument', () => {
    // The default is what makes this non-breaking. Every current caller writes
    // `createPendingLedger()` and passes items with no payload.
    const ledger = createPendingLedger()
    ledger.ingest([{ id: 'x', messageIndex: 0 }])
    expect(ledger.findNext()?.id).toBe('x')
    expectTypeOf<PendingItem>().toHaveProperty('id')
  })

  it('test_settling_and_pruning_still_behave_the_same_with_a_payload', () => {
    // The behaviours the ledger exists for must be untouched by the widening: a settled id does not
    // come back, and a prune drops what no longer exists.
    const ledger = createPendingLedger<RenderState>()
    ledger.ingest([
      { id: 'a', messageIndex: 1, payload: { renderedAt: 1, collapsed: false } },
      { id: 'b', messageIndex: 5, payload: { renderedAt: 2, collapsed: true } },
    ])
    expect(ledger.settle('a')).toBe(true)
    ledger.ingest([{ id: 'a', messageIndex: 1, payload: { renderedAt: 9, collapsed: false } }])
    expect(ledger.findNext()?.id, 'a settled id must not be resurrected by a re-poll').toBe('b')
    expect(ledger.pruneBefore(4)).toBe(0)
    expect(ledger.findNext()?.id).toBe('b')
  })
})
