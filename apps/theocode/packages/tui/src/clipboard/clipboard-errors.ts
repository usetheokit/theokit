/**
 * B-075 — there is no clipboard here at all: ssh without forwarding, a container, CI.
 *
 * A typed error rather than a silent no-op, because a copy that quietly did nothing is discovered
 * by the user only when they paste (`rules/error-handling.md` § 2).
 */
import { TheokitAgentError } from '@theokit/agents'

import { CLIPBOARD_COMMANDS } from './clipboard-commands.js'

export class NoClipboardError extends TheokitAgentError {
  override readonly name = 'NoClipboardError'

  constructor() {
    super(
      `no clipboard is reachable from here — tried ${CLIPBOARD_COMMANDS.map((c) => c.bin).join(', ')}. ` +
        `This is normal over ssh without forwarding, in a container, or in CI. ` +
        `Install one of them, or use /export to write the conversation to a file.`,
    )
  }
}
