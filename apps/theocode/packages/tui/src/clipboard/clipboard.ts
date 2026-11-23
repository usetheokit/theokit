/**
 * B-075 — putting text on the system clipboard, or saying clearly that there is none.
 *
 * The copy itself (candidate binaries, the bounded `spawnSync`, ENOENT fall-through, typed errors)
 * is `@theokit/tui/terminal`'s. This module keeps the app's two decisions: the result is `{ bin }`,
 * and an absent clipboard says what to do instead (`/export`).
 */
import {
  NoClipboardError,
  copyToClipboard as copy,
  type CopyToClipboardOptions,
} from '@theokit/tui/terminal'

export { ClipboardWriteError, NoClipboardError } from '@theokit/tui/terminal'

/** An absent clipboard, with the way out: this is normal over ssh, in a container, or in CI. */
class NoClipboardWithGuidance extends NoClipboardError {
  constructor(tried: readonly string[]) {
    super(tried)
    this.message =
      `no clipboard is reachable from here — tried ${tried.join(', ')}. ` +
      `This is normal over ssh without forwarding, in a container, or in CI. ` +
      `Install one of them, or use /export to write the conversation to a file.`
  }
}

/**
 * Copy `text` to the system clipboard.
 *
 * @throws NoClipboardError when no candidate binary exists.
 * @throws ClipboardWriteError when one exists and refuses the text.
 */
export function copyToClipboard(
  text: string,
  opts: CopyToClipboardOptions = {},
): { bin: string } {
  try {
    return { bin: copy(text, opts).via }
  } catch (e: unknown) {
    if (e instanceof NoClipboardError) throw new NoClipboardWithGuidance(e.tried)
    throw e
  }
}
