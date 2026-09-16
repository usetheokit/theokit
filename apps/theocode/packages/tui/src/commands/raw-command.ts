/**
 * `/raw` — putting a reply into the terminal's own scrollback, where the mouse can reach it.
 *
 * ## The problem, stated precisely
 *
 * Ink owns the screen. Every `<Text>` it draws is laid out by Yoga against the measured width and
 * HARD-wrapped — real newlines inserted into the output — and the transcript sits inside bordered
 * boxes with role glyphs down the left. Mouse-selecting a reply therefore yields box characters,
 * glyphs, and a paragraph broken at whatever column the window happened to be. `/copy` and
 * `/export` avoid all of that by reading the timeline instead of the frame, and neither helps the
 * person who wants to drag over three lines of a code block with their mouse.
 *
 * ## What this is NOT, and the toast says so
 *
 * It is not a mode. Codex's `/raw` toggles the transcript's render mode (`HistoryRenderMode::Raw`)
 * so every cell from then on draws its source text, and that is unreachable here for two reasons
 * measured against this build's dependencies rather than assumed:
 *
 *   1. `AgentTimeline` (`@theokit/tui@0.77.0`) takes `events`, `windowSize`, `windowOverscan` and
 *      `header`. There is no render-mode prop, so the transcript cannot be asked for raw cells.
 *   2. Even replacing it would not be enough. Ink 7's `textWrap` admits `wrap | hard | truncate-*`
 *      and nothing that means "leave the line alone", so ANY text rendered inside the layout is
 *      either broken at the border or cut off at it. Copy-friendliness is a property of text that
 *      never entered the layout.
 *
 * So the reachable capability is the one that actually solves the user's problem: hand the text to
 * the terminal outside the frame, once, on request. `useStdout().write` is Ink's supported seam for
 * exactly this — it erases the live frame, writes the string verbatim, and repaints the frame
 * underneath, leaving the string in scrollback with its own line breaks intact. The terminal then
 * SOFT-wraps it, which is the difference that matters: a soft-wrapped line copies as one line.
 *
 * Calling that a raw mode would be the overstatement this repository refuses elsewhere, so the
 * toast says what happened — text was printed above — and the menu entry describes a print, not a
 * toggle.
 *
 * The text itself comes from the same two functions `/copy` and `/export` use. Three commands
 * reading three different notions of "the last reply" is how one of them comes to disagree about
 * what a reply is.
 */
import type { ToastPayload } from '../screen-types.js'
import { conversationToMarkdown, lastAssistantText } from '../transcript-export.js'

/** The one argument, spelled the way `/export` spells its optional path: a bare word. */
const ALL = 'all'

/**
 * Print the last reply — or, with `all`, the whole conversation — above the frame.
 *
 * `writeToScrollback` is Ink's `useStdout().write`, threaded through the capabilities rather than
 * reached for here. Writing to the raw stream instead would land the text INSIDE the region Ink
 * repaints, and the next frame would erase it: the command would look like it did nothing, which is
 * the failure mode a text-extraction command can least afford.
 */
export function handleRaw(
  arg: string,
  events: readonly unknown[],
  writeToScrollback: (text: string) => void,
  setToast: (toast: ToastPayload) => void,
): void {
  const requested = arg.trim().toLowerCase()
  if (requested.length > 0 && requested !== ALL) {
    setToast({
      message: `"${arg.trim()}" is not a /raw target — /raw prints the last reply, /raw ${ALL} the whole conversation`,
      variant: 'error',
    })
    return
  }
  const wantsAll = requested === ALL
  const text = wantsAll ? conversationToMarkdown(events) : lastAssistantText(events)
  if (text === undefined || text.length === 0) {
    setToast({
      message: wantsAll
        ? 'nothing to print — this conversation is empty'
        : 'nothing to print — the agent has not replied yet',
      variant: 'info',
    })
    return
  }
  // A blank line on each side: the text lands directly under the transcript's last box, and without
  // the separation it reads as part of it — which would undo half of what this command is for.
  writeToScrollback(`\n${text}\n\n`)
  setToast({
    message: `${wantsAll ? 'conversation' : 'last reply'} printed above as plain text — select it with the mouse`,
    variant: 'success',
  })
}
