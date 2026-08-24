import { loadJsonl, transcriptPath, transcriptRoot } from '@theokit/sdk/persistence'

/**
 * The state of one thread's stored history (usetheokit/theokit#399).
 *
 * ## Why three values and not two
 *
 * An application reading a transcript must catch: a brand-new thread has no file yet, and raising
 * there would 500 the first turn of every conversation. That catch is mandatory — and it swallows
 * every other read failure with it. A transcript that exists and cannot be parsed came back as the
 * same empty, successful, warm greeting as a thread that never had one.
 *
 * `unreadable` is that third case, taken back out. It is the same shape `liveness-oracle.ts` uses
 * one file over, for the same reason its docstring gives: a caller acts on the answer, and "I could
 * not tell" must not be spelled like "there is nothing".
 *
 * ## What `absent` does NOT mean
 *
 * It does not separate a LOST conversation from a NEW one, and nothing in this package can. The
 * thread id is minted client-side (`client/agent-client.ts`) and nothing records that it was ever
 * issued, so on disk a garbage id and an unused one are the same fact: no file.
 *
 * That distinction belongs to whoever knows where the id CAME FROM. An application that restored an
 * id from storage and finds `absent` is looking at a loss and can say so; the same `absent` for an
 * id the client just minted is a new conversation. The knowledge exists — it is simply not here.
 *
 * Making the server able to answer it would take a record of every id ever issued, with tombstones
 * that survive the transcript's deletion, which is unbounded growth plus a retention policy
 * `transcript-gc.ts` deliberately leaves to the application. That is a product decision, not a
 * missing function, and it is not taken here.
 */
export type ThreadHistoryState =
  /** The transcript exists and parsed. */
  | 'present'
  /** No transcript. A new thread, or one whose id was never used — see above. */
  | 'absent'
  /** A transcript exists and could not be read. NOT the same as having none. */
  | 'unreadable'

export interface ThreadHistory {
  readonly state: ThreadHistoryState
  /** The rows, when `present`. Empty otherwise — never a partial read presented as a whole one. */
  readonly messages: readonly Record<string, unknown>[]
  /**
   * Why, when `unreadable`.
   *
   * Carried because the alternative is an operator reading "unreadable" and going to the logs for
   * something this call already knows.
   */
  readonly reason?: string
}

export interface ReadThreadHistoryOptions {
  /** The project directory the transcript is filed under. */
  readonly cwd: string
  /** Transcript root. Defaults to the SDK's, which honours `THEOKIT_HOME`. */
  readonly root?: string
}

const ABSENT: ThreadHistory = { state: 'absent', messages: [] }

/** Read one thread's stored history, distinguishing "none" from "could not read". */
export function readThreadHistory(
  sessionId: string,
  options: ReadThreadHistoryOptions,
): ThreadHistory {
  const path = transcriptPath(options.root ?? transcriptRoot(), options.cwd, sessionId)
  try {
    return { state: 'present', messages: loadJsonl(path) }
  } catch (err) {
    // ENOENT is the ONLY absence. Everything else — a parse error, a permission error, a directory
    // where a file should be — is a transcript this process could not read, and reporting it as
    // "no history" is the defect this function exists to remove.
    if (isNotFound(err)) return ABSENT
    return { state: 'unreadable', messages: [], reason: messageOf(err) }
  }
}

function isNotFound(err: unknown): boolean {
  return (err as { code?: unknown } | null)?.code === 'ENOENT'
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
