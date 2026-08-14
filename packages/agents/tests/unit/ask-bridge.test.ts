import { describe, expect, it, vi } from 'vitest'

import {
  ConcurrentListenerError,
  ConcurrentQuestionError,
  type PendingQuestion,
  QuestionAbandonedError,
  createAskBridge,
} from '../../src/ask/ask-bridge.js'
import { askUserVia } from '../../src/ask/ask-user-via.js'

/**
 * M77 — the ask channel.
 *
 * ## The asymmetry this closes
 *
 * "Pause the turn for a human" existed only for tool APPROVAL. The sibling case — the agent ASKS
 * something mid-turn — had a tool (`createQuestionTool`) and no channel: the SDK's tool takes an
 * `askUser` callback and prefers `ctx.context.askUser`, and nothing in this layer ever supplied one.
 * A tool that cannot reach a human is a tool that times out.
 *
 * Modelled on `ApprovalRegistry`, which already solved the same problem for approvals: hold the live
 * resolver in memory, settle it from the outside, keep one process-wide instance because the promise
 * being awaited and the promise being settled must be the same object.
 */

describe('ask / answer — the round trip', () => {
  it('test_a_question_resolves_with_the_answer_that_was_given', async () => {
    const bridge = createAskBridge()
    const seen: { id: string; question: string }[] = []
    bridge.setListener('t1', (q) => {
      seen.push(q)
    })

    const pending = bridge.ask('t1', 'Which branch?')
    expect(seen).toHaveLength(1)
    expect(seen[0].question).toBe('Which branch?')

    bridge.answer(seen[0].id, 'workspace')
    await expect(pending).resolves.toBe('workspace')
  })

  it('test_answering_an_unknown_id_reports_false_instead_of_throwing', () => {
    // A late answer — the user clicked after the turn ended — is ordinary, not exceptional. Throwing
    // would make the UI's happy path a try/catch.
    expect(createAskBridge().answer('nope', 'x')).toBe(false)
  })

  it('test_answering_TWICE_settles_once_and_reports_the_second_as_unknown', () => {
    // The bug the ledger exists for on the client side: without this, a second click sends a second
    // answer to a question already settled.
    const bridge = createAskBridge()
    let asked = ''
    bridge.setListener('t1', (q) => {
      asked = q.id
    })
    void bridge.ask('t1', 'q?')
    expect(bridge.answer(asked, 'first')).toBe(true)
    expect(bridge.answer(asked, 'second')).toBe(false)
  })
})

describe('one question per thread', () => {
  it('test_a_SECOND_question_on_the_same_thread_is_refused_typed', async () => {
    // Two questions at once on one thread have no coherent UI: the answer cannot be attributed. The
    // refusal is typed so a caller can distinguish it from a transport failure.
    const bridge = createAskBridge()
    bridge.setListener('t1', () => undefined)
    const first = bridge.ask('t1', 'a?')
    await expect(bridge.ask('t1', 'b?')).rejects.toBeInstanceOf(ConcurrentQuestionError)
    bridge.abandon('t1')
    await expect(first).rejects.toBeInstanceOf(QuestionAbandonedError)
  })

  it('test_a_DIFFERENT_thread_may_ask_at_the_same_time', async () => {
    // The counter-proof: the key is the thread, not the process. Without this, refusing everything
    // would satisfy the test above — a channel that refuses every second question is not a channel.
    const bridge = createAskBridge()
    const ids: string[] = []
    bridge.setListener('t1', (q) => ids.push(q.id))
    bridge.setListener('t2', (q) => ids.push(q.id))
    const a = bridge.ask('t1', 'a?')
    const b = bridge.ask('t2', 'b?')
    bridge.answer(ids[0], 'A')
    bridge.answer(ids[1], 'B')
    await expect(Promise.all([a, b])).resolves.toEqual(['A', 'B'])
  })

  it('test_the_thread_is_free_again_after_the_question_settles', async () => {
    const bridge = createAskBridge()
    const ids: string[] = []
    bridge.setListener('t1', (q) => ids.push(q.id))
    const first = bridge.ask('t1', 'a?')
    bridge.answer(ids[0], 'A')
    await expect(first).resolves.toBe('A')

    // The slot is released by SETTLING, not only by abandoning. Without this the channel would
    // accept exactly one question per thread for the lifetime of the process.
    const second = bridge.ask('t1', 'b?')
    bridge.answer(ids[1], 'B')
    await expect(second).resolves.toBe('B')
  })
})

describe('one listener per thread', () => {
  it('test_a_SECOND_listener_is_refused_typed', () => {
    // Two listeners on one thread means the question is rendered twice and answered by whoever wins.
    // Refusing is the honest outcome; silently replacing would make the first surface go deaf with
    // no signal at all.
    const bridge = createAskBridge()
    bridge.setListener('t1', () => undefined)
    expect(() => bridge.setListener('t1', () => undefined)).toThrow(ConcurrentListenerError)
  })

  it('test_the_returned_disposer_frees_the_slot', () => {
    const bridge = createAskBridge()
    const off = bridge.setListener('t1', () => undefined)
    off()
    expect(() => bridge.setListener('t1', () => undefined)).not.toThrow()
  })

  it('test_asking_with_NO_listener_rejects_instead_of_hanging', async () => {
    // The failure the DoD names, in its other form: with nobody listening, awaiting forever means the
    // turn dies at the builtin's 5-minute timeout with no diagnosis. Failing now says why.
    await expect(createAskBridge().ask('t1', 'q?')).rejects.toBeInstanceOf(QuestionAbandonedError)
  })
})

describe('abandon — the bug that hung a turn for five minutes', () => {
  it('test_abandon_REJECTS_the_captured_promise', async () => {
    // The DoD's named test. Cancelling the run used to drop the pending question on the floor: the
    // promise the tool awaited was never settled, so the turn sat until the builtin's timeout fired.
    const bridge = createAskBridge()
    bridge.setListener('t1', () => undefined)
    const pending = bridge.ask('t1', 'q?')
    expect(bridge.abandon('t1')).toBe(true)
    await expect(pending).rejects.toBeInstanceOf(QuestionAbandonedError)
  })

  it('test_abandon_notifies_the_listener_so_the_UI_can_release_its_slot', () => {
    // Without the notification the prompt stays on screen waiting for an answer nobody awaits.
    const onAbandon = vi.fn()
    const bridge = createAskBridge()
    bridge.setListener('t1', () => undefined, { onAbandon })
    void bridge.ask('t1', 'q?').catch(() => undefined)
    bridge.abandon('t1')
    expect(onAbandon).toHaveBeenCalledTimes(1)
  })

  it('test_abandoning_a_thread_with_nothing_pending_is_false_not_an_error', () => {
    // Cleanup runs on every turn end, most of which asked nothing.
    expect(createAskBridge().abandon('t1')).toBe(false)
  })
})

describe('the errors are typed, and say what to do', () => {
  it('test_every_error_is_a_TheokitAgentError_with_a_stable_code', async () => {
    // Rule 8: a caller distinguishes "nobody is listening" from "already asking" from a transport
    // failure by TYPE, not by matching on message text.
    const bridge = createAskBridge()
    bridge.setListener('t1', () => undefined)
    void bridge.ask('t1', 'a?').catch(() => undefined)

    const concurrent = await bridge.ask('t1', 'b?').catch((e: unknown) => e)
    expect((concurrent as Error).name).toBe('ConcurrentQuestionError')
    expect((concurrent as Error).message).toMatch(/t1/)
  })
})

describe('askUserVia — the adapter the question tool consumes', () => {
  it('test_it_flips_the_arguments_so_the_tool_reaches_the_bridge', async () => {
    // The mismatch this exists for: the tool asks `(question, threadId?)` and the bridge routes by
    // `(threadId, question)`. Writing the flip at each call site is how the order eventually gets
    // swapped and a question is asked with the thread id as its text.
    const bridge = createAskBridge()
    let asked: PendingQuestion | undefined
    bridge.setListener('t1', (q) => {
      asked = q
    })

    const pending = askUserVia(bridge)('Which branch?', 't1')
    expect(asked?.question).toBe('Which branch?')
    expect(asked?.threadId).toBe('t1')
    bridge.answer(asked!.id, 'workspace')
    await expect(pending).resolves.toBe('workspace')
  })

  it('test_a_question_with_NO_thread_is_refused_rather_than_routed_somewhere', async () => {
    // Picking a default thread would attribute a human's answer to a conversation it does not
    // belong to — worse than failing, because the wrong turn acts on it.
    await expect(askUserVia(createAskBridge())('q?')).rejects.toBeInstanceOf(QuestionAbandonedError)
    await expect(askUserVia(createAskBridge())('q?', '')).rejects.toBeInstanceOf(
      QuestionAbandonedError,
    )
  })
})
