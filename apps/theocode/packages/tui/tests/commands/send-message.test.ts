/**
 * B-116 — the goal refusal in `sendMessage`, which had no test.
 *
 * Two refusals guard a running turn from being disturbed. The `streaming` one, in
 * `resume-command.ts`, is covered (`resume-command.test.ts`). This one was not, and it is the more
 * dangerous of the two to get wrong: dropping it does not throw and does not look broken — the
 * message simply goes to the agent while a goal is driving it, interleaving a human turn with the
 * goal's own, and the operator sees their message accepted.
 *
 * `lastSentMessage` is asserted alongside the send because it is what `/retry` replays. A refusal
 * that still recorded the message would make the next `/retry` send something the agent never
 * received, which is a worse failure than the one being refused.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { ToastPayload } from '../../src/screen-types.js'
import { sendMessage } from '../../src/commands/command-content.js'

function harness() {
  const agent = { send: vi.fn(), reset: vi.fn(), abort: vi.fn() }
  const lastSentMessage: MutableRefObject<string | null> = { current: null }
  const setToast = vi.fn() as unknown as Dispatch<SetStateAction<ToastPayload | null>>
  return { agent, lastSentMessage, setToast }
}

describe('sendMessage — a running goal owns the agent', () => {
  it('test_a_message_is_refused_while_a_goal_is_running', () => {
    const { agent, lastSentMessage, setToast } = harness()

    sendMessage('what is the status?', true, agent, lastSentMessage, setToast)

    expect(agent.send).not.toHaveBeenCalled()
    // Not recorded either — otherwise /retry would replay a message the agent never received.
    expect(lastSentMessage.current).toBeNull()
  })

  it('test_the_refusal_says_what_to_do_about_it', () => {
    // A refusal that only says "no" leaves the operator retyping the same message. This one names
    // both ways out, so the toast is asserted rather than merely counted.
    const { agent, lastSentMessage, setToast } = harness()

    sendMessage('hello', true, agent, lastSentMessage, setToast)

    expect(setToast).toHaveBeenCalledTimes(1)
    const payload = vi.mocked(setToast).mock.calls[0]?.[0] as ToastPayload
    expect(payload.message).toContain('A goal is running')
    expect(payload.message).toContain('Esc')
    expect(payload.variant).toBe('info')
  })

  it('test_a_message_goes_through_when_no_goal_is_running', () => {
    // Anti-vacuity. Without this the two cases above would also pass on a `sendMessage` that
    // refused everything.
    const { agent, lastSentMessage, setToast } = harness()

    sendMessage('hello', false, agent, lastSentMessage, setToast)

    expect(agent.send).toHaveBeenCalledWith({ message: 'hello' })
    expect(lastSentMessage.current).toBe('hello')
    // No toast: an ordinary send is not an event worth interrupting the surface for.
    expect(setToast).not.toHaveBeenCalled()
  })
})
