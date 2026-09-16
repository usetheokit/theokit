/**
 * `/statusline` — which of the footer's facts are drawn, for this session.
 *
 * The footer was a fixed run: model, effort, approval, sandbox, goal, credential, and the context
 * meter on the right. Every one of them earns its place for SOMEBODY, and that is exactly the
 * problem — a person who has run the same sandbox for a month reads past it, and on an eighty-column
 * terminal the six of them push the context meter off the end. Making the run a selection costs one
 * store and turns a fixed opinion into a default.
 *
 * ## The separator is not a `join`
 *
 * Today's footer reads `gpt-5.6 medium · suggest · sandbox:workspace-write · goal:pursuing (4s) ·
 * oauth`, and two of those gaps are not ` · `. The model and the effort are one phrase separated by
 * a space, because "medium" alone is not a fact anyone can read. `separatorBefore` keeps that
 * rather than flattening everything to one delimiter, which is Codex's own answer
 * (`TerminalTitleItem::separator_from_previous`) to the same question — and it means turning the
 * feature on changes WHICH items appear without changing how the remaining ones look.
 *
 * NOT PERSISTED. See `session-items.ts`, which carries the argument once for both commands.
 */
import { createItemSelection, useItemSelection } from './session-items.js'

export const STATUSLINE_ITEMS = [
  'model',
  'effort',
  'approval',
  'sandbox',
  'goal',
  'auth',
  'context',
] as const

export type StatuslineItem = (typeof STATUSLINE_ITEMS)[number]

/**
 * The default is EVERY item, which is what the footer already drew.
 *
 * Shipping a narrower default would be a second change wearing this one's clothes: nobody asked for
 * fewer facts, they asked to be able to choose. A user who wants fewer now types one command.
 */
export const statuslineSelection = createItemSelection(STATUSLINE_ITEMS, STATUSLINE_ITEMS)

/** One line per item for `/statusline`: what the word puts in the footer. */
export const STATUSLINE_ITEM_DESCRIPTIONS: Readonly<Record<StatuslineItem, string>> = {
  model: 'the model this session is using',
  effort: 'the reasoning effort',
  approval: 'what needs your say-so before it runs',
  sandbox: 'what the tools may touch on disk',
  goal: 'the running goal loop, when there is one',
  auth: 'which credential is in use',
  context: 'the context meter, on the right-hand side',
}

/**
 * `context` is drawn on the RIGHT of the footer, so it never joins the left-hand run.
 *
 * Exported because both the footer and `/statusline`'s report need the same split, and a footer
 * that dropped it from the left while the report claimed it was there would be a divergence nobody
 * would look for.
 */
export const isRightHandItem = (item: StatuslineItem): boolean => item === 'context'

/**
 * What goes in front of `item`, given what came before it. See the note above on why this is not a
 * single delimiter.
 */
export function separatorBefore(
  item: StatuslineItem,
  previous: StatuslineItem | undefined,
): string {
  if (previous === undefined) return ''
  if (item === 'effort' && previous === 'model') return ' '
  return ' · '
}

/** Read the selection from inside the footer, re-rendering when `/statusline` changes it. */
export function useStatuslineItems(): readonly StatuslineItem[] {
  return useItemSelection(statuslineSelection)
}
