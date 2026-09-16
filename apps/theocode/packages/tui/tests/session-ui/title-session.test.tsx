/**
 * The proof that the title FOLLOWS the session, rather than agreeing with itself once.
 *
 * The defect worth designing against here is invisible to any test that asks `composeTitle` what
 * the title should be. That function was never going to be wrong; the failure is a title written at
 * startup and never again, so the tab describes the model you switched away from and the session
 * you forked out of. Only a MOUNT can tell the two apart, which is the discipline
 * `theme-session.test.tsx` set: render the component `App` renders, change the fact, watch the
 * stream.
 *
 * The sink is passed in as a prop for a reason the suite would otherwise hide. Under
 * `ink-testing-library` the ambient stdout is not a TTY, and `setTerminalTitle` correctly writes
 * nothing to one — so a component that reached for `process.stdout` would emit nothing here and
 * every case below would pass on a feature that never ran.
 */
import { render } from 'ink-testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleTitle } from '../../src/commands/surface-commands.js'
import {
  TITLE_ITEMS,
  TerminalTitle,
  composeTitle,
  titleSelection,
  type TitleFacts,
} from '../../src/session-ui/title-session.js'
import { waitFor } from '../helpers/wait-for.js'

/**
 * The two answer channels, discarded.
 *
 * These cases assert what the SURFACE does, so the words are noise here — `surface-commands.test.ts`
 * is where the toast and the panel are read.
 */
const screen = () => ({ setToast: vi.fn(), setPanel: vi.fn() })

function sink() {
  const write = vi.fn<(data: string) => void>()
  return {
    out: { isTTY: true, write },
    write,
    all: () => write.mock.calls.map(([s]) => s).join(''),
  }
}

function facts(overrides: Partial<TitleFacts> = {}): TitleFacts {
  return { app: 'TheoCode', dir: 'TheoCode', model: 'gpt-5.6', session: 'tui-abc', ...overrides }
}

/** The OSC 0 payloads the sink saw, in order — the only thing a window title actually is. */
function titlesWritten(s: ReturnType<typeof sink>): string[] {
  // A pattern that avoided the framing bytes could not tell a title write from any other string.
  // eslint-disable-next-line no-control-regex -- the OSC framing IS the assertion
  return [...s.all().matchAll(/\u001b]0;(.*?)\u0007/g)].map((m) => m[1] as string)
}

/**
 * Let Ink commit — and wait for the commit rather than for a stopwatch.
 *
 * The same wait `theme-session.test.tsx` documents: a store write outside React's event handling
 * commits on a later tick, and reading the sink on the same tick reports "the command did nothing"
 * when it really means "the test asked too early".
 *
 * It was a flat 50 ms. Every case below knows exactly how many OSC payloads it is expecting, so the
 * honest wait is for that count to arrive — it ends on the write instead of on a guess, and a write
 * that never comes is reported as "only 1 of 2 titles was written" rather than as a `/title` that
 * silently did nothing.
 */
const titlesSettle = async (s: ReturnType<typeof sink>, count: number): Promise<void> =>
  waitFor(() => titlesWritten(s).length >= count, `${String(count)} title write(s) to reach the stream`)

afterEach(() => {
  titleSelection.reset()
})

describe('the terminal title is written from a mounted frame', () => {
  it('test_mounting_writes_the_default_title_to_the_stream', () => {
    const s = sink()

    const { unmount } = render(<TerminalTitle facts={facts()} out={s.out} />)

    expect(
      titlesWritten(s),
      'the frame mounted without ever telling the terminal what it is',
    ).toEqual(['TheoCode — TheoCode'])
    unmount()
  })

  it('test_the_title_is_rewritten_when_the_model_changes', async () => {
    // The requirement in one case. A title set once at startup passes every other assertion in
    // this file and fails this one, which is why it exists.
    const s = sink()
    titleSelection.select(['app', 'model'])
    const { rerender, unmount } = render(<TerminalTitle facts={facts()} out={s.out} />)

    rerender(<TerminalTitle facts={facts({ model: 'gpt-5.6-terra' })} out={s.out} />)
    await titlesSettle(s, 2)

    expect(titlesWritten(s), 'the tab kept naming the model this session left').toEqual([
      'TheoCode — gpt-5.6',
      'TheoCode — gpt-5.6-terra',
    ])
    unmount()
  })

  it('test_a_render_that_changes_no_fact_writes_nothing_further', async () => {
    // Anti-thrash. The effect runs on every commit, and a streaming turn commits dozens of times a
    // second; a terminal repainting its tab bar at that rate is visible and is read as a fault.
    //
    // The assertion is a NEGATIVE — "nothing more was written" — and a negative taken after a fixed
    // sleep passes for two reasons: nothing was written, or the write has not landed yet. So the
    // unchanged rerender is followed by a rerender that DOES change a fact, and the wait is for that
    // second title. Once it has arrived, everything the identical rerender would have emitted has
    // had its turn, and the sequence of writes says whether it emitted one: two entries means it
    // stayed quiet, three means it thrashed.
    const s = sink()
    titleSelection.select(['app', 'model'])
    const { rerender, unmount } = render(<TerminalTitle facts={facts()} out={s.out} />)

    rerender(<TerminalTitle facts={facts()} out={s.out} />)
    rerender(<TerminalTitle facts={facts({ model: 'gpt-5.6-terra' })} out={s.out} />)
    await titlesSettle(s, 2)

    expect(titlesWritten(s), 'an unchanged title was re-emitted').toEqual([
      'TheoCode — gpt-5.6',
      'TheoCode — gpt-5.6-terra',
    ])
    unmount()
  })

  it('test_the_title_command_repaints_the_tab_of_a_mounted_frame', async () => {
    // End to end: the words a user types, through the handler, into the stream. Every case above
    // could pass with `/title` refusing every argument.
    const s = sink()
    const { unmount } = render(<TerminalTitle facts={facts()} out={s.out} />)

    handleTitle('session', screen())
    await titlesSettle(s, 2)

    expect(titlesWritten(s).at(-1), '/title never reached the terminal').toBe('tui-abc')
    unmount()
  })

  it('test_title_none_clears_the_tab_instead_of_leaving_our_string_on_it', async () => {
    // "Off" has to be a write. Skipping the empty one would leave the last title we set on screen,
    // so the command that turns the feature off would visibly not.
    const s = sink()
    const { unmount } = render(<TerminalTitle facts={facts()} out={s.out} />)

    handleTitle('none', screen())
    await titlesSettle(s, 2)

    expect(titlesWritten(s).at(-1), '/title none left our title on the tab').toBe('')
    unmount()
  })

  it('test_an_unmounted_frame_stops_being_notified', () => {
    // The subscription's other half, counted rather than watched for an error: a listener left
    // behind after unmount calls `setState` on a tree React has thrown away and throws nothing.
    const before = titleSelection.subscriberCountForTest()
    const s = sink()
    const { unmount } = render(<TerminalTitle facts={facts()} out={s.out} />)
    const mounted = titleSelection.subscriberCountForTest()

    unmount()

    expect(mounted, 'the mounted frame never subscribed at all').toBeGreaterThan(before)
    expect(
      titleSelection.subscriberCountForTest(),
      'unmounting left a listener behind — the next /title will notify a dead tree',
    ).toBe(before)
  })
})

describe('composing the title from the selected items', () => {
  it('test_every_item_in_the_vocabulary_resolves_to_a_fact', () => {
    // What holds the vocabulary and the fact record together. An item that parses and has no fact
    // behind it would render as an empty segment and be silently dropped, so `/title <that word>`
    // would succeed and change nothing.
    for (const item of TITLE_ITEMS) {
      expect(composeTitle([item], facts()), `${item} is offered but renders nothing`).not.toBe('')
    }
  })

  it('test_an_item_whose_fact_is_empty_is_dropped_rather_than_left_as_a_gap', () => {
    // A fresh session has no id until the first turn, and `TheoCode — ` reads as a truncated title
    // rather than as an absent value.
    expect(composeTitle(['app', 'session'], facts({ session: '' }))).toBe('TheoCode')
  })

  it('test_the_items_are_joined_in_the_order_they_were_selected', () => {
    expect(composeTitle(['model', 'app'], facts())).toBe('gpt-5.6 — TheoCode')
  })
})
