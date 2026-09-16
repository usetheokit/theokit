/**
 * `/statusline` and `/title` — the two commands that ask "which facts do you want to see, and
 * where?".
 *
 * One file for both, the way `pty-commands.ts` holds `/ps` and `/stop`: they are the same verb
 * applied to two surfaces, they share a parser and a refusal, and splitting them would put the one
 * sentence that must stay identical — the durability warning — in two places.
 *
 * ## The refusal is the interesting half
 *
 * Both commands turn an unknown word down by NAMING the vocabulary, and both leave the surface
 * exactly as it was when they do. `parseItems` is all-or-nothing for that reason: applying the
 * words it recognised and dropping the rest would repaint the footer, report success, and leave the
 * typo to be discovered later by someone wondering where their sandbox mode went.
 *
 * ## Session-only, said out loud on the branch that performs the change
 *
 * The argument is `memory-switch.ts`'s and it is quoted rather than re-derived: a durable
 * preference belongs in config, where it can be reviewed, rather than in a switch someone flipped
 * once and forgot. A user who is told nothing about durability assumes the wrong one and finds out
 * at the next launch — so the success toast says it, every time, and not only the first.
 */
import type { ContentPanel, ToastPayload } from '../screen-types.js'
import { parseItems, type ItemSelection } from '../session-ui/session-items.js'
import { STATUSLINE_ITEM_DESCRIPTIONS, statuslineSelection } from '../session-ui/statusline-session.js'
import { TITLE_ITEM_DESCRIPTIONS, titleSelection } from '../session-ui/title-session.js'

/**
 * The two ways these commands answer.
 *
 * Both, because the two answers are different sizes. A CHANGE is one line and auto-dismisses, the
 * way `/theme` reports a switch. The bare REPORT is a selection plus a seven-word vocabulary with a
 * description each, and a five-second toast is the wrong container for something a user has to read
 * before they can type the next command — `/permissions` is the precedent: a value, its meaning and
 * the command that changes it, on a panel that waits for Esc.
 */
interface SurfaceScreen {
  readonly setToast: (toast: ToastPayload) => void
  readonly setPanel: (panel: ContentPanel) => void
}

/** The word that puts a surface back the way it shipped. Both commands take it; see `reset`. */
const DEFAULT_WORD = 'default'

/** `/title` only — the title is the one surface that belongs to something outside this program. */
const NONE_WORD = 'none'

/** How a selection reads back: the items in order, or the fact that there are none. */
function selectionLine<T extends string>(selection: ItemSelection<T>): string {
  const items = selection.current()
  const shown = items.length === 0 ? '(nothing)' : items.join(' · ')
  return selection.isDefault() ? `${shown} (default)` : shown
}

/** The vocabulary, one item per line, so the report doubles as the menu. */
function vocabularyLines(
  vocabulary: readonly string[],
  descriptions: Readonly<Record<string, string>>,
): string {
  const width = Math.max(...vocabulary.map((item) => item.length))
  return vocabulary.map((item) => `  ${item.padEnd(width)}  ${descriptions[item] ?? ''}`).join('\n')
}

/**
 * The half both commands share: `default` restores, anything else is parsed as a list.
 *
 * `command` is threaded in only so the messages name the command the user typed. Deriving it from
 * the selection would tie the store to the word that happens to reach it, which is the coupling
 * that makes a store impossible to reuse for a second surface.
 */
function applyItems<T extends string>(
  requested: string,
  selection: ItemSelection<T>,
  command: string,
  setToast: SurfaceScreen['setToast'],
): void {
  if (requested === DEFAULT_WORD) {
    selection.reset()
    setToast({ message: `${command}: ${selectionLine(selection)}`, variant: 'success' })
    return
  }
  const parsed = parseItems(requested, selection.vocabulary)
  if (!parsed.ok) {
    setToast({
      message:
        `not ${command} items: ${parsed.unknown.join(', ')} — ` +
        `expected ${selection.vocabulary.join(' | ')}`,
      variant: 'error',
    })
    return
  }
  selection.select(parsed.items)
  setToast({
    message:
      `${command}: ${selectionLine(selection)} — this session only; ` +
      `/${command} ${DEFAULT_WORD} puts it back`,
    variant: 'success',
  })
}

/**
 * The bare report: what is drawn, what could be, and how to change it.
 *
 * The vocabulary is rendered from the SAME constant the parser validates against, so the panel
 * cannot offer a word the command then rejects — the property `permissions-panel.ts` states for its
 * own two knobs, and the reason neither panel types its menu out by hand.
 */
function reportPanel<T extends string>(
  selection: ItemSelection<T>,
  command: string,
  descriptions: Readonly<Record<string, string>>,
  footer: string,
): ContentPanel {
  return {
    title: command,
    body: [
      `${command}: ${selectionLine(selection)}`,
      '',
      vocabularyLines(selection.vocabulary, descriptions),
      '',
      footer,
    ].join('\n'),
  }
}

/** `/statusline` reports; `/statusline <items>` picks; `/statusline default` restores. */
export function handleStatusline(arg: string, screen: SurfaceScreen): void {
  const requested = arg.trim().toLowerCase()
  if (requested.length === 0) {
    screen.setPanel(
      reportPanel(
        statuslineSelection,
        'statusline',
        STATUSLINE_ITEM_DESCRIPTIONS,
        `/statusline <items> picks; /statusline ${DEFAULT_WORD} puts it back. ` +
          'The choice lasts for this session only.',
      ),
    )
    return
  }
  applyItems(requested, statuslineSelection, 'statusline', screen.setToast)
}

/**
 * `/title` reports; `/title <items>` picks; `/title none` clears it; `/title default` restores.
 *
 * `none` exists here and not on `/statusline` because the two surfaces are not equally ours. The
 * footer is inside a frame this program draws and erases; the window title is a property of
 * something that outlives the process, and a user who does not want their tabs rewritten must be
 * able to say so without also being asked to quit.
 *
 * For the same reason the report ends by promising the title back. It is the one fact a user cannot
 * check from inside the session, and "this program rewrote my tab and I do not know if it will undo
 * that" is a reasonable thing to want answered before typing the command.
 */
export function handleTitle(arg: string, screen: SurfaceScreen): void {
  const requested = arg.trim().toLowerCase()
  if (requested.length === 0) {
    screen.setPanel(
      reportPanel(
        titleSelection,
        'title',
        TITLE_ITEM_DESCRIPTIONS,
        `/title <items> picks; /title ${NONE_WORD} clears it; /title ${DEFAULT_WORD} puts it back. ` +
          'The choice lasts for this session only, and whatever your terminal had before is ' +
          'restored when this session ends.',
      ),
    )
    return
  }
  if (requested === NONE_WORD) {
    titleSelection.select([])
    screen.setToast({ message: 'title: cleared for this session', variant: 'success' })
    return
  }
  applyItems(requested, titleSelection, 'title', screen.setToast)
}
