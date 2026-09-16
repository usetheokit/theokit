/**
 * #70 — `/resume` must leave the screen saying the session was resumed.
 *
 * The transcript after `/resume` is the welcome banner and nothing else, because `clearEpoch`
 * remounts the timeline and `agent.thread` is never repopulated. That is INDISTINGUISHABLE from a
 * command that did nothing, while the model demonstrably has the earlier turns — the issue's step 6.
 *
 * The greeting could already say it. `useTimeline(agent, resumed)` writes "(resumed — I remember our
 * last conversation)" and `resumed` was bound to whether the PROCESS started on a session pointer,
 * so a mid-session `/resume` never reached the one affordance that existed.
 */
import { describe, expect, it } from 'vitest'

import { handleResume } from '../../src/commands/session-commands.js'
import { waitFor } from '../helpers/wait-for.js'

/**
 * `handleResume` starts an async body and returns immediately, so every case here has to wait for
 * something. What it waits ON is the point.
 *
 * Three fixed 20 ms sleeps used to stand in for "the async body has run". Two of the three cases
 * then assert a NEGATIVE — that the resumed flag never fired — and a negative asserted after a sleep
 * passes for two different reasons: the flag correctly stayed put, or the body had not reached it
 * yet. The second reading is the one a loaded runner produces, and it reads as a pass.
 *
 * The toast is what closes that hole. Both branches of `handleResume` end by calling `setToast` —
 * the refusal with its reason, the success with its confirmation — so "a toast was raised" means the
 * async body ran to completion on whichever branch it took. Waiting for it turns every assertion
 * below into a statement about a body that has FINISHED, negatives included.
 */
function resume(arg: string, streaming = false, known: string[] = ['tui-other', 'tui-current']) {
  const calls = { resumed: [] as boolean[], epoch: 0, session: '', toasts: 0 }
  handleResume(arg, {
    currentSessionId: () => 'tui-current',
    streaming,
    setSessionAndPersist: (id) => {
      calls.session = id
    },
    setClearEpoch: () => {
      calls.epoch += 1
    },
    setResumed: (v) => {
      calls.resumed.push(v as boolean)
    },
    setToast: () => {
      calls.toasts += 1
    },
    listKnownSessions: async () => known.map((agentId) => ({ agentId })),
  })
  return calls
}

/** Both branches end in a toast, so this is `handleResume` having finished whatever it decided. */
const settled = async (calls: { toasts: number }): Promise<void> =>
  waitFor(() => calls.toasts > 0, '/resume to finish and say what it decided')

describe('/resume makes itself visible', () => {
  it('test_a_refused_resume_does_not_claim_a_resumed_session', async () => {
    // Anti-vacuity, and the direction that matters: a refusal must not leave the banner announcing a
    // continuation that never happened. Refused because a turn is streaming.
    const calls = resume('tui-other', true)
    await settled(calls)

    expect(calls.resumed).toEqual([])
    expect(calls.epoch).toBe(0)
  })

  it('test_resuming_the_current_session_changes_nothing', async () => {
    // `planResume` refuses a no-op; the flag must not fire on it either.
    const calls = resume('tui-current')
    await settled(calls)

    expect(calls.resumed).toEqual([])
  })

  it('test_a_real_resume_marks_the_session_as_continued', async () => {
    // The finding. Before this the flag was bound to whether the PROCESS started on a session
    // pointer, so this path — the one an operator actually takes — never set it, and the screen said
    // nothing.
    const calls = resume('tui-other')
    await settled(calls)

    expect(calls.session, 'the session was not repointed').toBe('tui-other')
    expect(calls.resumed, 'the resume happened and the screen was never told').toEqual([true])
  })
})
