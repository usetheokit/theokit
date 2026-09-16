import { homedir } from 'node:os'

import { Box, Text, useStdout } from 'ink'
import { type ReactElement } from 'react'

import { AGENT } from '@theocode/shared/agent'
import { WelcomeBanner } from '@theokit/tui'
import {
  ACCENT,
  BANNER_TIPS,
  BANNER_WHATS_NEW,
  centred,
  LOGO,
  LOGO_COLUMNS,
  WIDE_COLS,
} from '../theme/theme.js'
import { workingDirectory } from '../working-directory.js'

const MODEL = AGENT.model
const WELCOME = `✻ Welcome to ${AGENT.name}`

/**
 * The room a hint has when there is no art column.
 *
 * `WelcomeBanner` caps a no-aside box at 60 columns and pads it by one on each side, so 56 is what
 * is left between the borders. Hard-coded because the cap is the component's and is not exported;
 * `Banner.test.tsx` asserts the result stays inside the border, which is what would catch it
 * moving.
 */
const NARROW_COLUMNS = 56
/**
 * B-057 — read at RENDER, not at import. A module constant is evaluated when the module is first
 * imported, and ESM hoists every import before the first statement runs — so it would capture the
 * directory before `setWorkingDirectory` had a chance to choose one. That is the same shape B-026
 * fixed in the CLI's bootstrap.
 */
const shortCwd = (): string => workingDirectory().replace(homedir(), '~')

/**
 * The working directory, shortened from the LEFT when it cannot fit.
 *
 * `dir` defaults to the real one and is injectable so the behaviour can be tested at a chosen
 * length: with the ambient directory the outcome depends on where the suite happens to run, and
 * "a path that fits is left alone" is unassertable on a checkout whose path does not fit.
 *
 * `WelcomeBanner` renders every hint as `<Text wrap="truncate-end">`, which drops the tail — and
 * the tail is the half that answers the question. On this repository that produced
 * `cwd: ~/Projetos/theo/theokit-fram…`: four levels of ancestry and no way to tell which of the
 * five sibling checkouts you are in. Cutting the HEAD instead keeps the leaf and the branch above
 * it (`…/usetheo-labs/TheoCode`), which is what a person is actually reading it for.
 *
 * Truncation happens here rather than being left to the SDK because a string that already fits is
 * never truncated by it — this is composition over the slot, not a second renderer.
 */
export function fittedCwd(available: number, dir: string = shortCwd()): string {
  const label = `cwd: ${dir}`
  const chars = [...label]
  if (chars.length <= available) return label
  // `…` costs one column, and `cwd: ` is kept so the row still says what it is.
  const room = available - 'cwd: '.length - 1
  return room <= 0 ? label : `cwd: …${chars.slice(chars.length - room).join('')}`
}

/** One heading plus its dim rows — the shape both aside sections share. */
function AsideSection({ title, rows }: { title: string; rows: readonly string[] }): ReactElement {
  return (
    <Box flexDirection="column">
      <Text color={ACCENT} bold>
        {title}
      </Text>
      <Box flexDirection="column">
        {rows.map((row) => (
          <Text key={row} dimColor>
            {row}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

/**
 * The rule that separates the two aside sections.
 *
 * Claude Code draws two rules — a vertical `│` between the art column and the panel, and a
 * horizontal one between "Tips for getting started" and "What's new". `WelcomeBanner` draws
 * neither: its two-column branch is a plain `marginLeft={2}` gutter and the `aside` slot is a free
 * `ReactNode` with no layout props of its own (D1). Both are therefore drawn HERE, inside the node
 * this component already owns — a border on a Box we render is composition, not a reimplementation
 * of the box.
 *
 * It is a `borderTop` on an empty Box rather than a `'─'.repeat(n)`, because there is no `n` to
 * repeat: the panel's width is whatever the SDK leaves after the art column, and a consumer cannot
 * read it. A bordered Box stretches to its flex container instead, so the rule spans the panel at
 * every terminal width. The fixed 34 it replaces was stubby at 150 columns and would have run past
 * the border below 100.
 */
function AsideRule(): ReactElement {
  return (
    <Box
      borderStyle="single"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderTopDimColor
    />
  )
}

/**
 * B-011 — the SDK's `WelcomeBanner`, not a hand-rolled copy of it.
 *
 * This used to rebuild the whole two-column welcome box: the bordered frame, the fixed-width left
 * column, the gutter and the right-hand panel. The SDK component does all of that, and the docstring
 * of its `aside` prop names the two headings below — the prop was built for this layout.
 *
 * Adopting it took three upstream fixes, every one found by rendering rather than by reading:
 * U-7 added `art` (this had `aside` and no art, `Banner` had art and no `aside`, so neither could
 * draw both), U-7b sized the art column so an aside cannot compress it, and U-7c stopped the box
 * capping itself at a width sized for the single-column layout, which let content run past the
 * border. Released as `@theokit/tui@0.50.2`.
 *
 * `art` replaces the bold `name` header — the `Banner` idiom U-7 followed — so the welcome line goes
 * in `tagline`, rendered under the art where it sat before.
 *
 * The width gate reads Ink's `useStdout`, the same source `WelcomeBanner` sizes its box from. It
 * used to read `process.stdout.columns` globally, recorded here as a known limitation — see the
 * comment on the gate for what that finally cost.
 */
export function Banner(): ReactElement {
  // Ink's stdout, NOT the global. `WelcomeBanner` sizes its box from `useStdout()`, so a gate
  // reading `process.stdout.columns` was answering a different question than the box it gates —
  // the two agreed only because nothing rendered this to a second output.
  //
  // That was recorded here as a known limitation for as long as it cost nothing. Widening the
  // wordmark made it cost something: the gate said "draw the aside" at 120 while the box was built
  // at 100, and 119 columns of content ran past the right border. `Banner.test.tsx` caught it,
  // which is the only reason it is not shipping.
  const { stdout } = useStdout()
  const wide = (stdout?.columns ?? 80) >= WIDE_COLS
  return (
    <WelcomeBanner
      name={AGENT.name}
      version={AGENT.version}
      // Claude Code's most recognisable trait — the product and build written INTO the top border:
      //
      //     ╭─── TheoCode v0.4.7 ──────────────────────────────╮
      //
      // It was not expressible until `@theokit/tui` grew `borderTitle` (usetheokit/theokit-tui):
      // the frame is an Ink `<Box borderStyle>` and Ink has no border label, so the only way to get
      // it was to hand-roll the whole box — which is what B-011 exists to stop.
      borderTitle={`${AGENT.name} v${AGENT.version}`}
      // The art rides WITH the aside, on one threshold, because both need the same room.
      //
      // Below it there is no width to draw a wordmark in: `WelcomeBanner` caps a no-aside box at 60
      // columns (`MAX_WIDTH`), leaving 56 for content, and the wordmark is 67. It does not shrink —
      // it WRAPS, and a wrapped box-drawing wordmark is not a smaller logo, it is broken glyphs.
      //
      // Omitting `art` is not a loss here: the component's own contract is that its absence
      // degrades to the bold `name`, and that degrade is the ONE path where `version` renders —
      // `staticBannerTree` picks art OR name+version, never both. So the narrow terminal gets the
      // product name and the build, which is what Codex puts in its header.
      {...(wide ? { art: LOGO } : {})}
      // Centred to match the reference: Claude Code stacks its identity lines centred under the
      // logo, and `WelcomeBanner` renders `tagline`/`hints` as plain left-aligned `<Text>` inside a
      // column it owns. Padding the STRING is the only lever a consumer has — the slot takes no
      // layout props (D1) — and it is exact only while the art fixes the column at `LOGO_COLUMNS`.
      // Without the art there is no such column, so centring against it would indent every line
      // off the right edge.
      // No version here any more. It used to be smuggled into the tagline on the wide branch,
      // because `version` was inert whenever `art` was set — one fact travelling by two mechanisms
      // chosen by terminal width. usetheokit/theokit-tui#155 fixed the prop, and `borderTitle`
      // above puts the build where both references put it, at every width.
      tagline={wide ? centred(WELCOME) : WELCOME}
      hints={
        wide
          ? [centred(MODEL), centred(fittedCwd(LOGO_COLUMNS))]
          : [MODEL, fittedCwd(NARROW_COLUMNS)]
      }
      {...(wide
        ? {
            // `asideDivider` draws the column rule AND lets the panel fill the width left over.
            // Both used to be this file's problem: a computed `width` that re-derived the SDK's own
            // padding arithmetic (`columns - LOGO_COLUMNS - 6`), a cross-axis `flexGrow` so the rule
            // reached the bottom border, and a `borderLeft` on our own Box because the SDK's gutter
            // is a margin and a margin cannot draw a rule. The 6 was correct and nothing on either
            // side would have noticed when it stopped being — usetheokit/theokit-tui#157.
            asideDivider: true,
            aside: (
              <>
                <AsideSection title="Tips for getting started" rows={BANNER_TIPS} />
                <AsideRule />
                <AsideSection title="What's new" rows={BANNER_WHATS_NEW} />
              </>
            ),
          }
        : {})}
    />
  )
}
