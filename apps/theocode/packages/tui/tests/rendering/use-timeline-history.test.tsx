/**
 * #70 — a resumed session renders what it restored.
 *
 * The mitigation from the first pass told the user the session was resumed. This is the other half:
 * the turns themselves. `useTimeline` composes the array the timeline draws, so the history goes in
 * as a PREFIX — after the greeting, before whatever the live stream folds into `agent.thread`.
 *
 * A prefix rather than a seed into the thread, for the reason the toolkit records for its own
 * equivalent: the fold resets on a reconnect and history must survive that, because it was never
 * part of the fold.
 *
 * NOTE ON THE SEAM. `@theokit/tui@0.80.0` added `initialMessages` to `useAgentStream` for exactly
 * this, and this product does not use that hook — its agent comes from `@theokit/agents`'
 * `useAgent`, and `useTimeline` owns the composition. So the toolkit fix is not what unblocked this;
 * `readSessionMessages` in `@theokit/sdk@5.0.0-next.4` is. Written down because the two look
 * interchangeable from the issue thread and are not.
 */
import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { useTimeline } from '../../src/rendering/use-timeline.js'
import { waitFor } from '../helpers/wait-for.js'

type Events = ReturnType<typeof useTimeline>['events']

/**
 * Rendered TWICE and read once a timeline has actually been published, because `useCoalesced` bounds
 * recomputation by TIME. Reading a window that has not closed yet returns an empty timeline, which
 * looks exactly like the bug under test.
 *
 * The wait is on THE TIMELINE HAVING ARRIVED, not on a duration. It used to be `setTimeout(60)`
 * against a 34 ms budget (`coalesceWindowMs(TUI_MAX_FPS)`) — a bet that the trailing update lands
 * inside 60 ms of wall clock on a runner that runs `cpus - 4` files at once. Losing that bet reads as
 * "the resumed history is not on screen", the exact defect these cases exist to catch, so the suite
 * would have reported a product bug for a scheduling one.
 *
 * MEASURED while replacing the sleep, because the note it replaces asserted the opposite and nobody
 * had checked: against the pinned `@theokit/tui`, with the thread and the history both supplied at
 * mount, the value is published on the LEADING edge — `events.length` is 2 immediately after the
 * first render, and this wait therefore polls zero times. So the 60 ms was buying nothing here. The
 * guard stays because the hook's contract permits the trailing update the old note described, and
 * the day it takes it this fails by NAME rather than by handing the assertions an empty array.
 */
async function eventsOf(thread: unknown[], history: unknown[], resumed = true): Promise<Events> {
  let seen: Events = []
  function Probe(): null {
    seen = useTimeline({ thread } as never, resumed, history as never).events
    return null
  }
  const instance = render(<Probe />)
  instance.rerender(<Probe />)
  await waitFor(() => seen.length > 0, 'the coalescing window to close and publish a timeline')
  instance.unmount()
  return seen
}

const message = (id: string, text: string) => ({
  id,
  role: 'assistant' as const,
  parts: [{ type: 'text', text }],
})

describe('#70 — the resumed history in the timeline', () => {
  it('test_the_restored_turns_are_drawn', async () => {
    const texts = JSON.stringify(await eventsOf([], [message('h0', 'earlier turn')]))

    expect(texts, 'the session was resumed and its turns are not on screen').toContain('earlier turn')
  })

  it('test_history_precedes_the_live_thread', async () => {
    const out = await eventsOf([message('t0', 'live turn')], [message('h0', 'earlier turn')])
    const json = JSON.stringify(out)

    // Present BEFORE ordered. Found by running the inversion for this file — deleting the history
    // prefix from `useTimeline` left this case green, because `indexOf` returns -1 for the turn that
    // is not there and -1 is duly less than the index of the one that is. An ordering assertion over
    // an absent element orders nothing.
    expect(json, 'the restored turn is not in the timeline at all').toContain('earlier turn')
    expect(json.indexOf('earlier turn')).toBeLessThan(json.indexOf('live turn'))
  })

  it('test_the_greeting_still_comes_first', async () => {
    // It is the frame's opening line; history appearing above it would read as a rendering fault.
    const out = await eventsOf([], [message('h0', 'earlier turn')])

    // `greeting::mN` is how the projection ids each part of a message; the prefix is the message.
    expect(out[0]?.id).toBe('greeting::m0')
  })

  it('test_no_history_renders_exactly_what_it_did_before', async () => {
    // The anti-regression floor: every session that is NOT a resume goes through this same path.
    const out = await eventsOf([message('t0', 'live turn')], [], false)

    expect(out.map((e) => e.id)).toEqual(['greeting::m0', 't0::m0'])
  })
})
