/**
 * #948 — a reply stopped with Esc carries a line that says it was stopped.
 *
 * The interrupt worked (measured: the count stopped at 166 of 400), and the transcript recorded
 * nothing about it, so the partial answer read as a finished one. Claude Code prints
 * `Interrupted by user` under the cut reply; this does the same, as a `system` line, so the copy
 * and export paths that read the last ASSISTANT text never pick the marker up as the answer.
 */
import { render } from 'ink-testing-library'
import { describe, expect, it, vi } from 'vitest'

import { makeInterruptTurn } from '../../src/agent-session/interrupt.js'
import { INTERRUPTED_TEXT, lastMessageId } from '../../src/rendering/interrupt-marks.js'
import { useTimeline } from '../../src/rendering/use-timeline.js'
import { waitFor } from '../helpers/wait-for.js'

type Events = ReturnType<typeof useTimeline>['events']

async function eventsOf(thread: unknown[], interrupted: ReadonlySet<string>): Promise<Events> {
  let seen: Events = []
  function Probe(): null {
    seen = useTimeline({ thread } as never, false, [], interrupted).events
    return null
  }
  const instance = render(<Probe />)
  instance.rerender(<Probe />)
  await waitFor(() => seen.length > 0, 'the coalescing window to close and publish a timeline')
  instance.unmount()
  return seen
}

const user = { id: 'u1', role: 'user' as const, parts: [{ type: 'text', text: 'count to 400' }] }
const partial = { id: 'a1', role: 'assistant' as const, parts: [{ type: 'text', text: '1\n2\n3' }] }

describe('an interrupted reply says so in the transcript', () => {
  it('test_the_interrupted_reply_is_followed_by_the_marker', async () => {
    const events = await eventsOf([user, partial], new Set(['a1']))

    const reply = events.findIndex((e) => e.kind === 'message' && e.text.includes('3'))
    const marker = events.findIndex((e) => e.kind === 'message' && e.text === INTERRUPTED_TEXT)
    expect(marker, 'no interrupted marker in the timeline').toBeGreaterThan(-1)
    expect(marker).toBe(reply + 1)
    expect(events[marker]).toMatchObject({ role: 'system' })
  })

  it('test_a_reply_that_was_not_interrupted_has_no_marker', async () => {
    const events = await eventsOf([user, partial], new Set())

    expect(JSON.stringify(events)).not.toContain(INTERRUPTED_TEXT)
  })

  it('test_an_interrupt_before_any_reply_marks_the_request', async () => {
    // Esc while the model is still thinking: there is no assistant message yet, so the marker goes
    // under the request it stopped.
    expect(lastMessageId([user])).toBe('u1')
    const events = await eventsOf([user], new Set(['u1']))

    expect(JSON.stringify(events)).toContain(INTERRUPTED_TEXT)
  })
})

describe('the interrupt records which message it cut', () => {
  const deps = (over: Partial<Parameters<typeof makeInterruptTurn>[0]> = {}) => ({
    abort: vi.fn(),
    forkSession: vi.fn(() => ({ newId: 'n', copied: true })),
    hasActiveTurn: () => true,
    hasPendingApproval: () => false,
    onForkFailure: vi.fn(),
    onInterrupted: vi.fn(),
    ...over,
  })

  it('test_an_interrupt_of_a_streaming_turn_is_recorded', () => {
    const d = deps()
    makeInterruptTurn(d)()

    expect(d.abort).toHaveBeenCalledOnce()
    expect(d.onInterrupted).toHaveBeenCalledOnce()
  })

  it('test_esc_with_no_active_turn_records_nothing', () => {
    const d = deps({ hasActiveTurn: () => false })
    makeInterruptTurn(d)()

    expect(d.onInterrupted).not.toHaveBeenCalled()
  })
})
