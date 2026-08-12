/**
 * B-123 — folding a content-event stream into a product's lifecycle vocabulary.
 *
 * ADR 0007 decided the split: the NAMES belong to the product (`thread.started` is one wire contract
 * among several, and a framework that picks one has picked a side), and the FOLD does not. This is
 * the fold.
 *
 * The invariant it carries is the one a hand-rolled emitter gets wrong, and it is not stylistic — a
 * turn that never closes leaves a consumer waiting forever, and a turn that closes twice makes a
 * failed run look successful to whoever read the second event. Measured in the one existing emitter:
 * the error path and the finish path each close the turn, and only an `errorSeen` flag threaded
 * through both keeps them from doing it twice.
 *
 * Generic by the same test as the security floor, the layer fold, the trust posture, the wiring
 * record and the key router: the vocabulary arrives as data, and nothing here names a Codex event.
 */

import { describe, expect, it } from 'vitest'

import { foldTurnLifecycle, type LifecycleVocabulary } from '../src/turn-lifecycle.js'

/** A caller's dialect. Deliberately not the Codex one — the framework must not know it. */
const DIALECT: LifecycleVocabulary<string> = {
  threadStarted: (id) => `thread:${id}`,
  turnStarted: () => 'turn:open',
  itemStarted: (item) => `item+:${item.id}:${item.kind}`,
  itemCompleted: (item) => `item-:${item.id}:${item.kind}`,
  turnCompleted: (usage) => `turn:done:${JSON.stringify(usage ?? null)}`,
  turnFailed: (error) => `turn:failed:${error.message}`,
}

const fold = (threadId = 't1') => foldTurnLifecycle(DIALECT, threadId)

describe('foldTurnLifecycle — a turn opens once', () => {
  it('test_opening_emits_the_thread_and_the_turn_in_that_order', () => {
    expect(fold('abc').opened).toEqual(['thread:abc', 'turn:open'])
  })

  it('test_the_thread_id_reaches_the_vocabulary', () => {
    // Anti-vacuity: a fold that ignored its argument would satisfy the ordering case above.
    expect(fold('other').opened[0]).toBe('thread:other')
  })
})

describe('foldTurnLifecycle — a turn closes exactly once', () => {
  it('test_a_clean_stream_closes_as_completed', () => {
    const turn = fold()
    expect(turn.finish({ status: 'ok', usage: { tokens: 7 } })).toEqual([
      'turn:done:{"tokens":7}',
    ])
  })

  it('test_an_error_in_the_stream_closes_as_failed_not_completed', () => {
    // The defect this exists for. An error mid-stream and a clean finish both reach `finish`, and an
    // emitter that forgets the flag reports a failed run as completed.
    const turn = fold()
    turn.observe({ kind: 'error', message: 'boom' })

    expect(turn.finish({ status: 'ok' })).toEqual(['turn:failed:boom'])
  })

  it('test_finishing_twice_emits_nothing_the_second_time', () => {
    // A turn that closes twice makes a consumer act on the second event. Idempotence here is worth
    // more than a throw: the second call is a caller bug, and crashing loses the first, correct close.
    const turn = fold()
    turn.finish({ status: 'ok' })

    expect(turn.finish({ status: 'error', error: 'late' })).toEqual([])
  })

  it('test_a_declared_error_status_closes_as_failed_even_with_a_clean_stream', () => {
    expect(fold().finish({ status: 'error', error: 'transport died' })).toEqual([
      'turn:failed:transport died',
    ])
  })

  it('test_the_turn_is_reported_open_until_it_closes', () => {
    // What lets a caller assert the invariant rather than trust it.
    const turn = fold()
    expect(turn.isOpen).toBe(true)
    turn.finish({ status: 'ok' })
    expect(turn.isOpen).toBe(false)
  })
})

describe('foldTurnLifecycle — items open and close', () => {
  it('test_a_tool_call_opens_an_item_and_its_result_closes_the_same_one', () => {
    const turn = fold()
    const started = turn.observe({ kind: 'tool-call', id: 'c1', name: 'read' })
    const completed = turn.observe({ kind: 'tool-result', id: 'c1', name: 'read' })

    expect(started).toEqual(['item+:c1:read'])
    expect(completed).toEqual(['item-:c1:read'])
  })

  it('test_a_call_and_its_result_share_an_id_when_the_stream_omits_one', () => {
    // The pairing IS the point of item events: a surface matches the close to the open by id. The
    // first version of this case compared two RESULTS, which differ under any implementation — so
    // it passed while a call and its own result were getting different ids.
    const turn = fold()
    const started = turn.observe({ kind: 'tool-call', name: 'read' })
    const completed = turn.observe({ kind: 'tool-result', name: 'read' })

    expect(started).toEqual(['item+:item_0:read'])
    expect(completed).toEqual(['item-:item_0:read'])
  })

  it('test_two_calls_in_one_turn_do_not_share_an_id', () => {
    // The other half. Falling back to the tool NAME would pair them, and the second result would
    // close the first item.
    const turn = fold()
    turn.observe({ kind: 'tool-call', name: 'read' })
    turn.observe({ kind: 'tool-result', name: 'read' })
    turn.observe({ kind: 'tool-call', name: 'read' })

    expect(turn.observe({ kind: 'tool-result', name: 'read' })).toEqual(['item-:item_1:read'])
  })
})

describe('foldTurnLifecycle — accumulated text is one item, flushed at the end', () => {
  it('test_text_deltas_emit_nothing_until_the_turn_finishes', () => {
    const turn = fold()

    expect(turn.observe({ kind: 'text', delta: 'hel' })).toEqual([])
    expect(turn.observe({ kind: 'text', delta: 'lo' })).toEqual([])
  })

  it('test_the_accumulated_text_is_flushed_as_one_item_before_the_turn_closes', () => {
    const turn = fold()
    turn.observe({ kind: 'text', delta: 'hel' })
    turn.observe({ kind: 'text', delta: 'lo' })
    const closing = turn.finish({ status: 'ok' })

    expect(closing[0]).toBe('item-:message:hello')
    expect(closing.at(-1)).toContain('turn:done')
  })

  it('test_whitespace_only_text_is_not_flushed_as_an_item', () => {
    // An empty message item is worse than none: a surface renders a blank bubble for it.
    const turn = fold()
    turn.observe({ kind: 'text', delta: '   \n ' })

    expect(turn.finish({ status: 'ok' })).toEqual(['turn:done:null'])
  })
})

describe('foldTurnLifecycle — nothing is observed after the turn closes', () => {
  it('test_a_chunk_arriving_late_emits_nothing', () => {
    // A stream can outlive its consumer's decision to stop. Emitting an item after the turn closed
    // would put it outside any turn, which no dialect can express.
    const turn = fold()
    turn.finish({ status: 'ok' })

    expect(turn.observe({ kind: 'tool-call', id: 'x', name: 'late' })).toEqual([])
  })
})
