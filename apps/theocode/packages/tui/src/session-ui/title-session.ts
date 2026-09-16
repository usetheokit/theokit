/**
 * `/title` — what the terminal's tab says this window is, for this session.
 *
 * ## Which items, and why these four
 *
 * Codex offers twenty-four, most of which describe facts this build does not have (rate-limit
 * windows, enterprise credits, a thread title the model wrote). Copying the list would have meant
 * copying names that resolve to nothing. What survives is the question the title actually answers,
 * which is "which of these six windows is which": the product, the repository, the model, and the
 * session. Anything that changes second by second — a spinner, a token count — is deliberately out:
 * a title that animates is what makes people turn the feature off, and the footer already carries
 * the live numbers on a surface that is meant to move.
 *
 * ## Why it is a MOUNTED component and not a call at startup
 *
 * The precedent is `theme-session.tsx`, and the reason is the same defect in a different place. A
 * title written once in `main.tsx` is correct until the first `/model` or `/fork`, after which the
 * tab describes a session that no longer exists — and every test that asked the module what the
 * title should be would still pass, because the string was right and nobody wrote it. So the
 * subscription and the write live in a component: mounting it is what proves the escape reaches the
 * stream, and re-rendering it on a changed fact is what keeps it true.
 *
 * The write is keyed on the composed TEXT, not on the facts. Two different facts that render the
 * same title emit nothing, which matters more than it looks — the effect runs on every commit of a
 * streaming turn, and a terminal repainting its tab bar thirty times a second is visible.
 */
import { useEffect } from 'react'

import type { OscSink } from '@theokit/tui'

import { createItemSelection, useItemSelection } from './session-items.js'
import { writeTerminalTitle } from '../terminal-io/terminal-title.js'

export const TITLE_ITEMS = ['app', 'dir', 'model', 'session'] as const

export type TitleItem = (typeof TITLE_ITEMS)[number]

/**
 * The default: the product and the directory it is working in.
 *
 * Deliberately the two facts that do NOT change during a session, which is what makes them the
 * right default rather than merely a safe one — the question a tab bar is read to answer is "which
 * window is the one in `TheoCode`", and a default carrying the model would push the directory out
 * of the visible part of a narrow tab to say something the footer already says.
 */
const DEFAULT_TITLE_ITEMS: readonly TitleItem[] = ['app', 'dir']

export const titleSelection = createItemSelection(TITLE_ITEMS, DEFAULT_TITLE_ITEMS)

/** What each item resolves to, gathered by the caller so this module reads no ambient state. */
export interface TitleFacts {
  readonly app: string
  /** The working directory's LEAF. A full path does not fit a tab and its tail is the useful half. */
  readonly dir: string
  readonly model: string
  readonly session: string
}

/** One line for `/title` and the `/` menu: what each word puts in the tab. */
export const TITLE_ITEM_DESCRIPTIONS: Readonly<Record<TitleItem, string>> = {
  app: 'the product name',
  dir: "the working directory's last segment",
  model: 'the model this session is using',
  session: 'the session id',
}

/**
 * Join the selected facts.
 *
 * An item whose fact is empty is DROPPED rather than rendered as a gap. The session id is empty
 * before the first turn in a fresh session, and ` — ` with nothing after it reads as a truncated
 * title rather than as an absent value.
 */
export function composeTitle(items: readonly TitleItem[], facts: TitleFacts): string {
  return items
    .map((item) => facts[item].trim())
    .filter((value) => value.length > 0)
    .join(' — ')
}

/**
 * Renders nothing; keeps the tab honest.
 *
 * `out` is a prop rather than a module default so the mount can be tested against a sink that
 * declares itself a TTY. Under `ink-testing-library` the ambient stdout is not one, so a component
 * reaching for `process.stdout` would write nothing and the test would pass on a feature that never
 * ran — which is the exact shape of vacuity this component exists to rule out.
 */
export function TerminalTitle({ facts, out }: { facts: TitleFacts; out: OscSink }): null {
  const items = useItemSelection(titleSelection)
  const text = composeTitle(items, facts)
  useEffect(() => {
    writeTerminalTitle(text, out)
  }, [text, out])
  return null
}
