/**
 * A session-scoped selection from a fixed vocabulary — the mechanism `/statusline` and `/title`
 * both are.
 *
 * Two commands arrived at the same shape at the same time: a surface built from a list of named
 * items, a default list, and a word the user types to change which items appear. Writing that twice
 * would duplicate the one part of it that is easy to get wrong and impossible to see — the
 * NOTIFICATION. `theme-session.tsx` spells out why: a store that mutates without telling React is
 * picked up by the next unrelated render and not by the one that mattered, which reads as a
 * rendering bug rather than as a command that did nothing. One implementation, tested once.
 *
 * What is deliberately NOT shared is the vocabulary, the default and the wording. Those are the two
 * surfaces' own, and folding them together would make the terminal title and the footer describe
 * each other.
 *
 * NOT PERSISTED, and the argument is `memory-switch.ts`'s, quoted rather than re-derived: a durable
 * preference belongs in config, where it can be reviewed, rather than in a switch someone flipped
 * once and forgot. Both commands report their current selection, so a session-scoped change is
 * never invisible.
 */
import { useSyncExternalStore } from 'react'

/** @see createItemSelection */
export interface ItemSelection<T extends string> {
  /** Every item this surface can draw. The single source the parser and the reports both read. */
  readonly vocabulary: readonly T[]
  /** What is being drawn right now — the session's choice, or the default while it has none. */
  current: () => readonly T[]
  /** Whether the default is still in force. A second fact from `current()`, not a substitute. */
  isDefault: () => boolean
  select: (items: readonly T[]) => void
  /** Back to the default. Without it a user who narrows a surface cannot widen it again. */
  reset: () => void
  subscribe: (listener: () => void) => () => void
  /**
   * Test-only: how many surfaces are listening.
   *
   * Exposed for the reason `themeSubscriberCountForTest` is: the unsubscribe is otherwise
   * unobservable, and "it did not throw" is not a test of it — a listener left behind after unmount
   * survives every assertion a frame can make while growing the set on each remount.
   */
  subscriberCountForTest: () => number
}

/**
 * Build one selection store.
 *
 * `current()` returns the SAME array reference until something writes, which is what lets
 * `useSyncExternalStore` compare snapshots and skip a re-render. Returning a fresh copy each call
 * would re-render every consumer on every render of every parent — the defect `theme.ts` documents
 * for `TheoTUIProvider`'s memoised theme prop, in another costume.
 */
export function createItemSelection<T extends string>(
  vocabulary: readonly T[],
  fallback: readonly T[],
): ItemSelection<T> {
  let override: readonly T[] | undefined
  const listeners = new Set<() => void>()
  const notify = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    vocabulary,
    current: () => override ?? fallback,
    isDefault: () => override === undefined,
    select: (items) => {
      override = Object.freeze([...items])
      notify()
    },
    reset: () => {
      override = undefined
      notify()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscriberCountForTest: () => listeners.size,
  }
}

/** Read a selection from inside the rendered tree, re-rendering when it is changed. */
export function useItemSelection<T extends string>(selection: ItemSelection<T>): readonly T[] {
  return useSyncExternalStore(selection.subscribe, selection.current, selection.current)
}

/** What `parseItems` decided: every word, or the ones it could not place. */
export type ItemParse<T extends string> =
  | { readonly ok: true; readonly items: readonly T[] }
  | { readonly ok: false; readonly unknown: readonly string[] }

/**
 * Turn what the user typed into a selection, ALL-OR-NOTHING.
 *
 * A partial parse is the failure worth designing against: `/statusline model sandbux` would drop
 * one word, apply the rest, and report success — so the user reads a footer that changed, assumes
 * the command worked, and discovers the typo when they wonder where the sandbox went. Rejecting the
 * whole line and naming the words that failed leaves the surface exactly as it was.
 *
 * Commas are accepted alongside spaces because the reports print the selection `·`-joined and
 * comma-separated lists are what fingers produce from reading one. Duplicates collapse in place: an
 * item repeated is a slip, not a request to draw it twice.
 */
export function parseItems<T extends string>(
  input: string,
  vocabulary: readonly T[],
): ItemParse<T> {
  const words = input
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((word) => word.length > 0)
  const unknown = words.filter((word) => !(vocabulary as readonly string[]).includes(word))
  if (unknown.length > 0) return { ok: false, unknown: [...new Set(unknown)] }
  return { ok: true, items: [...new Set(words)] as T[] }
}
