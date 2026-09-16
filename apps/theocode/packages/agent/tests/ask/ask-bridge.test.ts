/**
 * B-004 — a question that is abandoned must settle.
 *
 * `ask()` built its promise capturing only `resolve`, so `reject` was not merely unused — it was
 * unreachable. `abandon()` then deleted the pending entry and returned, dropping the captured
 * `resolve` on the floor. The promise it had handed the SDK never settled.
 *
 * What the user saw: pressing ESC freed the UI (the slot was released) while the turn stayed blocked
 * until the built-in's 5-minute timeout. The UI said the question was gone; the model was still
 * waiting for it.
 *
 * ## Why this file no longer constructs a bridge
 *
 * The rendezvous moved to `@theokit/agents/ask`; what remains here is the ADDRESS TRANSLATION
 * between the framework (answers by question id) and this product's surface (answers by thread).
 * The tests therefore drive the module's functions, which are what the TUI imports and what the
 * translation lives in — and they are a process singleton, so each case uses its own thread id and
 * releases the listener slot before the next.
 *
 * Every guarantee the class-based version encoded is still asserted here: abandon settles, other
 * threads are undisturbed, answering resolves, a second question on a live thread is refused, and
 * the single listener slot refuses a second occupant rather than silently replacing it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

// `ConcurrentQuestionError` comes from the framework, not from this module: `ask-bridge.ts` used to
// re-export it, but a re-export nobody outside the tests imported is dead surface under the
// dead-export gate. Importing it from its real home keeps the `instanceof` assertions below exactly
// as strong — there is one class under this name in the process, which is the property B-004 cared
// about — and removes the indirection that made it look consumed.
import { ConcurrentQuestionError } from '@theokit/agents/ask'

// The package entrypoint's own re-export, aliased so the assertion below reads as the identity
// check it is: what `@theocode/agent/ask` hands a consumer IS the framework's class.
import { ConcurrentQuestionError as entrypointConcurrentQuestionError } from '../../src/ask/index.js'

import { abandonQuestion, answerQuestion, ask, currentQuestion, setListener } from '../../src/ask/ask-bridge.js'

/** Releases the singleton's listener slot so the next case can attach its own. */
let release: (() => void) | undefined
afterEach(() => {
  release?.()
  release = undefined
})

/**
 * Attach a surface. Required now, not optional: the framework REJECTS a question on a thread with
 * no listener, which is what replaced hanging until the built-in's timeout. A test that asked
 * without one would be exercising the refusal, not the rendezvous.
 */
function withSurface(): ReturnType<typeof vi.fn> {
  const notify = vi.fn()
  release = setListener(notify)
  return notify
}

describe('B-004 — abandoning a question settles its promise', () => {
  it('test_abandon_rejects_the_pending_question', async () => {
    withSurface()
    const answer = ask('which file?', 'abandon-1')

    abandonQuestion('abandon-1')

    await expect(
      answer,
      'the promise handed to the SDK never settled: `abandon()` dropped the pending entry without ' +
        'resolving or rejecting it, so the turn stays blocked until the 5-minute timeout even though ' +
        'the UI already released the slot.',
    ).rejects.toBeInstanceOf(Error)
  })

  it('test_abandon_does_not_disturb_another_thread', async () => {
    // Anti-vacuity floor: rejecting everything would satisfy the test above.
    withSurface()
    const kept = ask('kept?', 'thread-a')
    // Captured deliberately: `abandon` rejects, and an uncaught rejection here would be the very
    // defect B-013 is about — a promise nobody settles quietly taking the process down.
    const dropped = ask('dropped?', 'thread-b')
    const droppedSettled = expect(dropped).rejects.toBeInstanceOf(Error)

    abandonQuestion('thread-b')
    await droppedSettled
    answerQuestion('still here', 'thread-a')

    await expect(kept).resolves.toBe('still here')
  })

  it('test_answering_still_resolves', async () => {
    withSurface()
    const answer = ask('which file?', 'answer-1')

    expect(answerQuestion('src/index.ts', 'answer-1')).toBe(true)

    await expect(answer).resolves.toBe('src/index.ts')
  })

  it('test_a_second_question_on_the_same_thread_still_rejects_as_concurrent', async () => {
    withSurface()
    const first = ask('first?', 'concurrent-1')

    await expect(ask('second?', 'concurrent-1')).rejects.toBeInstanceOf(ConcurrentQuestionError)

    // Settle the first one too, so the test leaves no pending promise behind.
    answerQuestion('answered', 'concurrent-1')
    await expect(first).resolves.toBe('answered')
  })

  it('test_answering_a_thread_with_nothing_pending_is_refused_not_misapplied', async () => {
    // The translation's own failure mode. This module maps thread → question id; an answer for a
    // thread it has no id for must be refused rather than applied to whatever is pending elsewhere.
    withSurface()
    expect(answerQuestion('nobody asked', 'empty-thread')).toBe(false)
  })
})

describe('the thread → id translation is what this module is now', () => {
  it('test_the_pending_question_is_readable_by_thread_while_it_is_open', async () => {
    // `currentQuestion` is a READ, and the TUI depends on it: the surface is notified with no
    // payload and then reads. Recording the text before notifying is what keeps that true.
    withSurface()
    const pending = ask('which branch?', 'read-1')

    expect(currentQuestion('read-1')).toBe('which branch?')

    answerQuestion('main', 'read-1')
    await expect(pending).resolves.toBe('main')
  })

  it('test_a_settled_question_is_FORGOTTEN_rather_than_left_readable', async () => {
    // The counter-proof, and the reason `ask` clears on settle. A stale entry would leave a prompt
    // on screen for a question that no longer exists, and would make the next answer on this thread
    // quote an id the framework has already dropped.
    withSurface()
    const pending = ask('which branch?', 'read-2')
    answerQuestion('main', 'read-2')
    await pending

    expect(currentQuestion('read-2')).toBeUndefined()
    expect(answerQuestion('again', 'read-2')).toBe(false)
  })

  it('test_an_abandoned_question_is_forgotten_too', async () => {
    withSurface()
    const pending = ask('which branch?', 'read-3')
    const settled = expect(pending).rejects.toBeInstanceOf(Error)
    abandonQuestion('read-3')
    await settled

    expect(currentQuestion('read-3')).toBeUndefined()
  })
})

describe('B-004 — the concurrent-question error is reachable and readable', () => {
  it('test_the_error_message_is_in_english', () => {
    // The SDK's built-in question tool only catches `err.message === "timeout"` and rethrows the
    // rest, so this error escapes the handler either way — that half is an upstream gap. What is
    // ours is the message the user and the model actually read.
    const err = new ConcurrentQuestionError('thread-a')

    expect(err.message).not.toMatch(/[áâãçéêíóôõú]/i)
    expect(err.message).toMatch(/already/i)
  })

  it('test_the_error_is_exported_from_the_package_entrypoint', () => {
    // Surfaces import from `@theocode/agent/ask`, never from the module directly. While the class
    // was absent from the entrypoint, no consumer could write `instanceof` against it — a typed
    // error nobody can catch by type is an untyped error with extra steps. It is the framework's
    // class now, which is what makes ONE class exist under that name in the process.
    //
    // The entrypoint is reached by a STATIC named import (see the top of this file) rather than by
    // indexing a namespace object with a string. Both assert the same contract, but the string form
    // is invisible to static analysis: the dead-export gate read this export as unconsumed and a
    // cleanup removed it, and only this assertion failing caught that. A test that pins a public
    // export should be legible to the tool that decides whether the export is public.
    expect(entrypointConcurrentQuestionError).toBe(ConcurrentQuestionError)
  })

  it('test_the_error_keeps_its_typed_code', () => {
    expect(new ConcurrentQuestionError('t').code).toBe('question_already_pending')
  })
})

describe('B-035 — the single slot is named for what it is, and a second set fails loudly', () => {
  /**
   * B-035 — the test that used to live here was VACUOUS, and it carried the name of the guarantee it
   * failed to encode. It asserted `first.calls + second.calls > 0` and that `second` was called.
   * Both hold PRECISELY when the first listener is silently replaced; `first` was never asserted on.
   * The comment above it said "losing a subscriber without a trace is not one of them" and the
   * assertions permitted exactly that.
   *
   * Only the TUI ever subscribes, so building a multicast nobody asked for is the YAGNI failure. It
   * is `setListener` now, and setting a second one over a live one throws rather than winning
   * silently.
   */
  it('test_setting_a_second_listener_over_a_live_one_throws', () => {
    withSurface()

    expect(
      () => setListener(vi.fn()),
      'a second setListener() replaced a live one, so a surface stopped being notified with no ' +
        'error and no warning',
    ).toThrow(/listener/i)
  })

  it('test_the_first_listener_keeps_receiving_after_a_rejected_second', async () => {
    // The assertion the old test should have made: `first` is still the one notified.
    const first = withSurface()
    try {
      setListener(vi.fn())
    } catch {
      // expected — asserted above
    }

    const pending = ask('anything?', 'slot-1')
    answerQuestion('done', 'slot-1')

    expect(first, 'the surviving listener was not the first one').toHaveBeenCalled()
    await expect(pending).resolves.toBe('done')
  })

  it('test_disposing_frees_the_slot_for_a_new_listener', () => {
    // Anti-vacuity floor: throwing on every second call would make the bridge unusable across a
    // surface restart, which is a real flow (the TUI unmounts and remounts).
    const dispose = setListener(vi.fn())
    dispose()

    expect(() => {
      release = setListener(vi.fn())
    }).not.toThrow()
  })
})
