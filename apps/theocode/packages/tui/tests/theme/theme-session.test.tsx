/**
 * The proof that `/theme` repaints the frame, rather than only agreeing with itself.
 *
 * The defect this replaces was invisible to any test that asked the module what the base is. The
 * base WAS correct — `resolveThemeBase` had been right since B-073 — and the frame still never
 * changed, because `App` read the value once at import and handed the provider a constant. So the
 * only assertion worth making here goes through a MOUNT: a child asks `useTheoTheme()` for a token
 * that differs between bases, and the test watches that token change after the command runs.
 *
 * `diff.addedBg` is the token, chosen because it is the one this product does NOT override: the
 * `accent`, the role prefixes and the tool glyphs are ours in every base, so asserting on them
 * would pass whichever palette the provider resolved. Its expected values are read from the
 * toolkit's own `themes` rather than typed as hex literals — a palette the toolkit revises is not a
 * regression in this file, and a copy of it here would report one every time.
 *
 * Exactly one component mounts, which is the discipline `InputSlot.test.tsx` set (ADR D3). It is
 * `ThemedSurface` itself — the component `App` renders — and not a replica of the two lines inside
 * it, because a replica proves the subscription works while `App` keeps rendering the old constant.
 */
import { render } from 'ink-testing-library'
import { Text } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

import { themes, useTheoTheme } from '@theokit/tui'

import { handleTheme } from '../../src/commands/theme-command.js'
import { THEME_BASES } from '../../src/theme/theme-base.js'
import {
  resetSessionThemeForTest,
  setSessionThemeBase,
  ThemedSurface,
  themeSubscriberCountForTest,
} from '../../src/theme/theme-session.js'
import { THEME_RESOLUTION } from '../../src/theme/theme.js'
import { waitFor } from '../helpers/wait-for.js'

/**
 * Renders one theme token as text, because that is the only way a test can see what the provider
 * resolved. `no-color` empties the value, so it is spelled rather than left blank — an assertion
 * against an empty frame would pass on a component that rendered nothing at all.
 */
function DiffBackgroundProbe(): ReactElement {
  const theme = useTheoTheme()
  return <Text>{`addedBg=${theme.diff.addedBg === '' ? 'none' : theme.diff.addedBg}`}</Text>
}

/** How the probe spells a base, so the expectations below never restate the toolkit's palette. */
function probeTextFor(base: (typeof THEME_BASES)[number]): string {
  const bg = themes[base].diff.addedBg
  return `addedBg=${bg === '' ? 'none' : bg}`
}

/**
 * Let Ink paint — and wait for the paint, not for a stopwatch.
 *
 * The store write happens outside React's own event handling, so the re-render it schedules is
 * committed on a later tick: Ink throttles its writes to the frame budget rather than emitting one
 * per `setState`. Reading `lastFrame()` on the same tick returns the frame BEFORE the switch, which
 * would read as "the switch did not reach the provider" and is really "the test asked too early".
 *
 * This was a flat 50 ms sleep. Fifty is not derived from anything — the frame budget is 34 ms
 * (`coalesceWindowMs(TUI_MAX_FPS)`) and this runner is documented as inflating a 700 ms test to
 * 5 100 ms under full-suite parallelism, so the margin over one frame is thinner than the contention
 * the same repository measures. `repainted` ends on the frame CHANGING, so a slow commit costs time
 * instead of a false red, and a commit that never comes is reported as "the frame never repainted"
 * rather than as a theme that failed to resolve.
 */
const repainted = async (lastFrame: () => string | undefined, before: string | undefined): Promise<void> =>
  waitFor(() => lastFrame() !== before, 'the mounted frame to repaint after the base changed')

/** A base the environment did NOT resolve, so "it switched" cannot be satisfied by standing still. */
const OTHER_BASE = THEME_BASES.find((base) => base !== THEME_RESOLUTION.base) as
  (typeof THEME_BASES)[number] | undefined

afterEach(() => {
  resetSessionThemeForTest()
})

describe('a theme picked in the session reaches the rendered provider', () => {
  it('test_the_frame_starts_on_the_base_the_environment_resolved', () => {
    // The anchor for every switch below. Without it a test that saw `light` after `/theme light`
    // would prove nothing on a machine whose THEOCODE_THEME was already light.
    const { lastFrame, unmount } = render(
      <ThemedSurface>
        <DiffBackgroundProbe />
      </ThemedSurface>,
    )

    expect(lastFrame(), 'the frame did not start on the resolved base').toContain(
      probeTextFor(THEME_RESOLUTION.base),
    )
    unmount()
  })

  it('test_switching_the_base_repaints_the_mounted_frame', async () => {
    expect(OTHER_BASE, 'the vocabulary collapsed to a single base').toBeDefined()
    const { lastFrame, unmount } = render(
      <ThemedSurface>
        <DiffBackgroundProbe />
      </ThemedSurface>,
    )
    const before = lastFrame()

    setSessionThemeBase(OTHER_BASE as (typeof THEME_BASES)[number])
    await repainted(lastFrame, before)

    expect(lastFrame(), 'the mounted frame kept the base it was built with').not.toBe(before)
    expect(lastFrame(), 'the provider did not resolve the base that was picked').toContain(
      probeTextFor(OTHER_BASE as (typeof THEME_BASES)[number]),
    )
    unmount()
  })

  it('test_the_theme_command_is_what_repaints_the_frame', async () => {
    // The end-to-end shape of the feature: the words a user types, through the handler, into the
    // provider. The test above could pass with `handleTheme` still refusing every argument.
    expect(OTHER_BASE, 'the vocabulary collapsed to a single base').toBeDefined()
    const { lastFrame, unmount } = render(
      <ThemedSurface>
        <DiffBackgroundProbe />
      </ThemedSurface>,
    )
    const before = lastFrame()

    handleTheme(OTHER_BASE as string, vi.fn(), () => true, () => '<store>')
    await repainted(lastFrame, before)

    expect(lastFrame(), '/theme did not reach the provider').toContain(
      probeTextFor(OTHER_BASE as (typeof THEME_BASES)[number]),
    )
    unmount()
  })

  it('test_every_base_in_the_vocabulary_can_actually_be_drawn', async () => {
    // `THEMES` is keyed by the vocabulary `/theme` validates against, and this is what holds the
    // two together: a base that parses and has no theme behind it would hand the provider an
    // `undefined` and fall back to the default palette with no error anywhere.
    const { lastFrame, unmount } = render(
      <ThemedSurface>
        <DiffBackgroundProbe />
      </ThemedSurface>,
    )

    for (const base of THEME_BASES) {
      setSessionThemeBase(base)
      // Waiting on the CONTENT rather than on a change, because one pass of this loop sets the base
      // the frame is already on: nothing repaints, and a wait for a change would time out on the one
      // base that was already correct. The condition is therefore already true for that pass and the
      // wait costs nothing; for every other base it ends on the repaint. The `expect` below restates
      // it so the case still reads as an assertion — the wait is what fails first, and it names the
      // base it was waiting for.
      await waitFor(
        () => lastFrame()?.includes(probeTextFor(base)) === true,
        `the frame to be drawn as ${base}`,
      )
      expect(lastFrame(), `${base} is offered but does not render as itself`).toContain(
        probeTextFor(base),
      )
    }
    unmount()
  })

  it('test_an_unmounted_frame_stops_being_notified', () => {
    // The subscription's other half. A listener left in the set after unmount is a leak that grows
    // with every remount and calls `setState` on a tree React has already thrown away — and it
    // throws nothing, which is why this counts rather than watching for an error.
    const before = themeSubscriberCountForTest()
    const { unmount } = render(
      <ThemedSurface>
        <DiffBackgroundProbe />
      </ThemedSurface>,
    )
    const mounted = themeSubscriberCountForTest()

    unmount()

    expect(mounted, 'the mounted frame never subscribed at all').toBeGreaterThan(before)
    expect(
      themeSubscriberCountForTest(),
      'unmounting left a listener behind — the next switch will notify a dead tree',
    ).toBe(before)
  })
})
