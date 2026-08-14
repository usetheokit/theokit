import { describe, expect, it } from 'vitest'

import { createPendingLedger } from '../../src/ask/pending-ledger.js'

/**
 * M77 — the client-side ledger of pending human decisions.
 *
 * ## Why this exists at all
 *
 * The framework's own lookup is STATELESS: `ApprovalRegistry.list()` reports what is pending right
 * now, and nothing remembers what a surface already showed or already answered. Two defects fall out
 * of that, and the consumer hit both:
 *
 * - **the dismissed card comes back** — the surface re-reads the list, sees the same approval, and
 *   renders it again;
 * - **a second answer is sent for an already-answered request** — the user clicks twice, or two
 *   surfaces answer, and the second send is a decision nobody made.
 *
 * ## What it deliberately is NOT
 *
 * There is no policy here. It never decides whether to approve, never talks to the registry, never
 * knows what an approval means. It is a bookkeeping structure over ids — which is exactly why it can
 * be a pure function of its own state and tested without a single mock.
 */

describe('ingest — what the surface has been told about', () => {
  it('test_a_new_item_becomes_pending', () => {
    const ledger = createPendingLedger()
    ledger.ingest([{ id: 'a', messageIndex: 1 }])
    expect(ledger.findNext()?.id).toBe('a')
  })

  it('test_re_ingesting_the_SAME_id_does_not_resurrect_a_settled_one', () => {
    // The defect this closes, in one test: the framework's list is stateless, so the settled item is
    // still in it on the next poll. Without this the dismissed card comes back forever.
    const ledger = createPendingLedger()
    ledger.ingest([{ id: 'a', messageIndex: 1 }])
    ledger.settle('a')
    ledger.ingest([{ id: 'a', messageIndex: 1 }])
    expect(ledger.findNext()).toBeUndefined()
  })

  it('test_ingest_is_additive_and_keeps_the_ones_already_known', () => {
    const ledger = createPendingLedger()
    ledger.ingest([{ id: 'a', messageIndex: 1 }])
    ledger.ingest([{ id: 'b', messageIndex: 2 }])
    expect(ledger.findNext()?.id).toBe('a')
    ledger.settle('a')
    expect(ledger.findNext()?.id).toBe('b')
  })
})

describe('settle — answering once, and only once', () => {
  it('test_settling_an_unsettled_item_reports_true', () => {
    const ledger = createPendingLedger()
    ledger.ingest([{ id: 'a', messageIndex: 1 }])
    expect(ledger.settle('a')).toBe(true)
  })

  it('test_settling_TWICE_reports_false_the_second_time', () => {
    // The second defect: the caller uses this boolean to decide whether to SEND. A ledger that said
    // `true` twice would send a decision the user made once, twice.
    const ledger = createPendingLedger()
    ledger.ingest([{ id: 'a', messageIndex: 1 }])
    ledger.settle('a')
    expect(ledger.settle('a')).toBe(false)
  })

  it('test_settling_something_never_ingested_reports_false', () => {
    expect(createPendingLedger().settle('ghost')).toBe(false)
  })
})

describe('findNext — one at a time, oldest first', () => {
  it('test_it_returns_the_LOWEST_message_index_not_the_insertion_order', () => {
    // A surface shows one decision at a time, and "oldest first" must mean the conversation's order,
    // not the order the poll happened to deliver. Ingesting out of order is normal: the list arrives
    // however the registry enumerated it.
    const ledger = createPendingLedger()
    ledger.ingest([
      { id: 'late', messageIndex: 9 },
      { id: 'early', messageIndex: 2 },
    ])
    expect(ledger.findNext()?.id).toBe('early')
  })

  it('test_it_returns_undefined_when_everything_is_settled', () => {
    const ledger = createPendingLedger()
    ledger.ingest([{ id: 'a', messageIndex: 1 }])
    ledger.settle('a')
    expect(ledger.findNext()).toBeUndefined()
  })
})

describe('pruneBefore — the conversation moved on', () => {
  it('test_items_older_than_the_cutoff_are_dropped', () => {
    // After a rewind or a fork, decisions attached to messages that no longer exist can never be
    // answered. Keeping them means `findNext` hands the surface a card for a message nobody can see.
    const ledger = createPendingLedger()
    ledger.ingest([
      { id: 'old', messageIndex: 1 },
      { id: 'current', messageIndex: 7 },
    ])
    expect(ledger.pruneBefore(5)).toBe(1)
    expect(ledger.findNext()?.id).toBe('current')
  })

  it('test_an_item_EXACTLY_at_the_cutoff_survives', () => {
    // The boundary, stated on purpose: the cutoff is the first index that still exists, so the item
    // sitting on it is current, not stale. Off by one here silently discards a live decision.
    const ledger = createPendingLedger()
    ledger.ingest([{ id: 'edge', messageIndex: 5 }])
    expect(ledger.pruneBefore(5)).toBe(0)
    expect(ledger.findNext()?.id).toBe('edge')
  })

  it('test_pruning_also_forgets_the_SETTLED_ones_so_the_ledger_does_not_grow_forever', () => {
    // Settled ids are kept precisely so a re-ingest cannot resurrect them — which means without
    // pruning they accumulate for the life of the session. Pruning is what bounds it.
    const ledger = createPendingLedger()
    ledger.ingest([{ id: 'a', messageIndex: 1 }])
    ledger.settle('a')
    ledger.pruneBefore(5)
    ledger.ingest([{ id: 'a', messageIndex: 1 }])
    // Honest consequence, stated rather than hidden: once pruned, an id is genuinely forgotten, so a
    // stale re-ingest of a pruned message index CAN re-add it. That is why pruning is driven by the
    // conversation's own cutoff and not by a timer.
    expect(ledger.findNext()?.id).toBe('a')
  })
})
