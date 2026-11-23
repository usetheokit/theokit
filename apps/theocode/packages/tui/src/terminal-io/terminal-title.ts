/**
 * The terminal window title: this app's wording over `@theokit/tui`.
 *
 * Sanitisation (`sanitizeTitle`), the TTY gate (`setTerminalTitle`) and the xterm title stack
 * (`pushTerminalTitle`) are the toolkit's. What stays here is the app's policy: the title is built
 * from text this product does not control (a `/model` word, a path), so it is cleaned BEFORE
 * `setTerminalTitle` gets it — that call throws on a control byte, and a throw inside a React
 * effect over a cosmetic knob would take the session down. An empty result clears the title.
 */
import type { OscSink } from '@theokit/tui'
import { pushTerminalTitle, sanitizeTitle, setTerminalTitle } from '@theokit/tui'

/** The title as it is safe to emit: no control characters, no whitespace runs, at most 240 chars. */
export function titleText(raw: string): string {
  return sanitizeTitle(raw)
}

/** Set the window title; a no-op on a non-TTY sink. */
export function writeTerminalTitle(text: string, out: OscSink = process.stdout): void {
  setTerminalTitle(titleText(text), out)
}

/**
 * Save the shell's title, and return an idempotent restore. Call once, BEFORE the first title is
 * written, so the push captures what the shell set rather than what we set.
 */
export function installTerminalTitle(out: OscSink = process.stdout): () => void {
  return pushTerminalTitle(out)
}
