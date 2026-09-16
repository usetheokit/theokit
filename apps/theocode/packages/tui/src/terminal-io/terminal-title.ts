/**
 * Writing — and giving back — the terminal's window title.
 *
 * This build set no title at all, so six terminals running six sessions were six identical tabs
 * called `node`. The capability is one OSC sequence wide, which is what makes the absence hard to
 * defend: `@theokit/tui` already exports `setTerminalTitle`, already gates it on `isTTY` so a piped
 * run stays clean, and already refuses a control byte rather than letting it reshape the escape.
 *
 * ## What this module adds on top of that
 *
 * SANITISATION, because the title is assembled from text this product does not control. `/model`
 * takes any word a user types and the working directory is whatever the filesystem holds, so a tab
 * character or a stray `\x07` is reachable without anyone being hostile — and `setTerminalTitle`
 * THROWS on one. A throw inside a React effect over a cosmetic knob would take the session down, so
 * the value is cleaned before it gets there rather than after.
 *
 * The clean-up is control characters, collapsed whitespace and a length cap. It is deliberately NOT
 * Codex's full set: that one also strips the Trojan-Source bidi controls, which is the right call
 * for a title that can carry MODEL OUTPUT (a thread title it generated) and is not yet earned here,
 * where the four items are a constant, a path leaf, a model name and a session id. If an item ever
 * carries prose the model wrote, the bidi table comes with it.
 *
 * RESTORATION, because leaving our string in someone's terminal after the process dies is a bug and
 * not a rough edge. The mechanism is xterm's title stack — `CSI 22;0t` pushes the title the shell
 * had, `CSI 23;0t` pops it back — which is what `vim`, `tmux` and `less` use for the same reason.
 * It is chosen over the obvious alternative of writing an EMPTY title at exit, and the difference
 * matters: clearing leaves a blank tab, and blank is not what the user had. Where the stack is not
 * implemented the pop is ignored and our title survives, which is the one failure this cannot cover
 * — reading the current title back is not portable, so there is nothing better to fall back to.
 */
import type { OscSink } from '@theokit/tui'
import { setTerminalTitle } from '@theokit/tui'

/**
 * Save the window title on the terminal's own stack, and pop it back.
 *
 * `0` selects both the icon name and the window title, which is the pair every terminal that
 * implements the stack treats as one unit.
 */
const PUSH_TITLE = '\u001b[22;0t'
const POP_TITLE = '\u001b[23;0t'

/**
 * The cap, in characters.
 *
 * Codex's number, and its reasoning holds unchanged: terminals silently truncate somewhere in the
 * low hundreds, and 240 leaves room for the framing bytes while staying readable in a tab bar. A
 * title long enough to be cut is already useless, so the cap costs nothing a user wanted.
 */
const MAX_TITLE_CHARS = 240

/**
 * The title as it is safe to emit: no control characters, no whitespace runs, bounded length.
 *
 * Returns `''` when nothing visible survives. The caller treats that as "clear the title" rather
 * than "leave the old one", which is the simplification this product can afford and Codex cannot:
 * the title on screen is one WE wrote over a value already saved on the stack, so blanking it
 * discards our own text and not the user's.
 */
export function titleText(raw: string): string {
  const cleaned = [...raw]
    // eslint-disable-next-line no-control-regex -- the point is to remove exactly these
    .filter((ch) => !/[\u0000-\u001f\u007f-\u009f]/.test(ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
  return [...cleaned].slice(0, MAX_TITLE_CHARS).join('')
}

/**
 * Set the window title. A no-op on a non-TTY sink, which the toolkit enforces rather than this.
 *
 * An empty `text` writes an empty payload — see `titleText` for why clearing is the right reading
 * of "nothing to show" here.
 */
export function writeTerminalTitle(text: string, out: OscSink = process.stdout): void {
  setTerminalTitle(titleText(text), out)
}

/**
 * Take ownership of the title, and hand it back.
 *
 * Called once, from the entry point, BEFORE the first title is written — the push has to capture
 * what the shell set, not what we set. The returned disposer is idempotent so the shutdown path and
 * a `process` exit hook can both call it without the second one emitting a stray sequence.
 *
 * On a non-TTY sink nothing is pushed and the disposer does nothing, so a piped run emits not one
 * escape byte. That is the same rule `setTerminalTitle` applies, restated here because this
 * function writes its sequences directly: the toolkit's guard does not cover them.
 */
export function installTerminalTitle(out: OscSink = process.stdout): () => void {
  if (out.isTTY !== true) return () => undefined
  out.write(PUSH_TITLE)
  let restored = false
  return () => {
    if (restored) return
    restored = true
    out.write(POP_TITLE)
  }
}
