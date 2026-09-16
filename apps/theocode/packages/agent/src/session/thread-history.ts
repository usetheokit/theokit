import { readSessionMessages, type SessionMessage } from '@theokit/sdk'

/** The reader, injected so the failure paths are testable without a transcript on disk. */
type Reader = (options: {
  sessionId: string
  cwd: string
}) => Promise<readonly SessionMessage[]> | readonly SessionMessage[]

/**
 * What a session already contains, for a surface that just repointed to it (#70).
 *
 * THE ONE PLACE THIS REPOSITORY IMPORTS `@theokit/sdk`. Everything else goes through
 * `@theokit/agents`, and that is still the layer — this is the exception, kept to a single file so it
 * is findable. `readSessionMessages` is only in the SDK: `@theokit/agents@12.1.0` does not forward
 * it, and `readThreadHistory`, which it does export, returns the raw Claude-shaped transcript rows
 * instead of the display shape. Measured, not assumed. Forwarding is worth asking for; reaching past
 * one layer for one function while saying so is better than blocking on the ask.
 *
 * No `sessionDir` is passed, and that is a decision rather than an omission: this product never sets
 * `local.sessionDir` — it moves the whole state root with `THEOKIT_HOME` instead, which the reader's
 * default already honours. Passing a second answer to the same question is the two-knobs hazard
 * `config/home-dir.ts` records at length. If `local.sessionDir` is ever set, this call has to learn
 * the same value, or the read looks in the default location and returns `[]` in silence.
 *
 * NEVER THROWS. A transcript that cannot be read is a rendering gap; letting it propagate would make
 * it a refusal to switch sessions, which is strictly worse than the empty screen this is fixing. The
 * failure is REPORTED rather than swallowed — `rules/error-handling.md` § 2 draws the line there.
 */
export async function readThreadMessages(
  sessionId: string,
  cwd: string,
  onWarn: (message: string) => void = () => {},
  read: Reader = readSessionMessages,
): Promise<readonly SessionMessage[]> {
  try {
    return await read({ sessionId, cwd })
  } catch (error) {
    onWarn(
      `could not read the transcript for session ${sessionId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    return []
  }
}
