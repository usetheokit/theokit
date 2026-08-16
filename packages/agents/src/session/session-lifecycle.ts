/* eslint-disable security/detect-non-literal-fs-filename --
 * Session lifecycle over the transcript root. Every path here is built from `transcriptRoot()` plus
 * a session id or an `encodeProjectDir` hash — never from HTTP input. The variable filename IS the
 * feature: a module whose job is listing and deleting sessions cannot address them by literal.
 */
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { TheokitAgentError } from '@theokit/sdk/errors'
import {
  classifySessionArtifact,
  forkTranscript,
  loadJsonl,
  sessionHasWriter,
  transcriptPath,
  transcriptRoot,
} from '@theokit/sdk/persistence'

// T2.2 follow-up — the bound lives in ONE place now. `SessionRegistryRemoverError` is re-exported
// because it was already public from this module: moving a symbol must not remove it from the
// surface, which would be a breaking change dressed as a refactor.
import { awaitRegistryRemoval, SessionRegistryRemoverError } from './gc/registry-remover.js'
import { projectDirFor } from './project-index.js'
import { sessionPointerPath } from './session-pointer.js'

export { SessionRegistryRemoverError }

/**
 * M71 — the session LIFECYCLE vocabulary: list, delete, protect, fork.
 *
 * ## Why this module exists, and what it deliberately is not
 *
 * The store is fully supplied — 29 pass-throughs under `/persistence` cover paths, atomic writes,
 * locks and artifact classification. What had no home was the vocabulary ABOVE them: listing,
 * deleting with a live-session guard, forking, going back before a turn.
 *
 * The named risk was that absorbing lifecycle reads as owning the store (G2). The separation is
 * real and this module is where it is drawn: **owning the vocabulary is not owning the store.**
 * Nothing here writes a transcript. Every file operation is either a delete of something the caller
 * named, or a delegation to an SDK primitive. The knowledge added is which files are protected and
 * what "delete a session" means — decisions, not storage.
 *
 * ## The asymmetry that made the gap a trap
 *
 * `Agent.delete` clears the REGISTRY ENTRY and never touches the transcript on disk. A consumer had
 * to discover that by measuring. {@link deleteSession} is the answer: it returns
 * `{ registryRemoved, transcriptRemoved }` so the two are impossible to confuse, and a caller that
 * wanted both and got one can see it.
 */

/** Raised when a lifecycle operation is refused because the session is live. */
/**
 * `removeFromRegistry` returned a thenable — the delete was refused rather than half-performed.
 *
 * The seam is synchronous by contract because `deleteSession` is. A caller whose registry is async
 * (which, measured, is every real one) awaits its own removal and then calls this with the outcome.
 */
export class SessionInUseError extends TheokitAgentError {
  override readonly name = 'SessionInUseError'

  constructor(
    readonly sessionId: string,
    /** Why it is protected — a writer lease, the resumable pointer, or being the most recent. */
    readonly reason: string,
  ) {
    super(
      `session "${sessionId}" is protected (${reason}). Deleting it would discard state something ` +
        `is still using. Stop the run, or pass { force: true } to delete anyway.`,
    )
  }
}

/** One session as the lifecycle vocabulary sees it. */
export interface SessionSummary {
  readonly id: string
  /** Absolute path of the transcript file. */
  readonly transcript: string
  /** Last modification, for recency ordering. */
  readonly modifiedAt: Date
}

/**
 * Sessions with a transcript under `cwd`'s project directory, most recent first.
 *
 * Uses `classifySessionArtifact` rather than matching file names here: the SDK owns what a file in a
 * project directory IS, and a second matcher would answer differently the day the layout changes —
 * silently, on a path whose purpose is deleting things.
 */
export function listSessions(cwd: string, root: string = transcriptRoot()): SessionSummary[] {
  const dir = projectDirFor(cwd, root)
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return [] // no project directory yet — no sessions, not an error
  }

  const found: SessionSummary[] = []
  for (const entry of entries) {
    const path = join(dir, entry)
    let isDirectory: boolean
    let modifiedAt: Date
    try {
      const stats = statSync(path)
      isDirectory = stats.isDirectory()
      modifiedAt = stats.mtime
    } catch {
      continue // vanished between readdir and stat — a concurrent delete, not our problem
    }

    // `classifySessionArtifact` answers WHAT the entry is; it deliberately does not answer WHICH
    // session, because the id is in the name and the SDK does not parse names for callers. So the
    // classification is the SDK's and only the trailing `.jsonl` strip is ours — a much smaller
    // thing to get wrong than re-deriving the four artifact kinds, which is what the consumer that
    // motivated this module had done.
    // The cast is the upstream `.d.ts` gap, named rather than hidden: `@theokit/sdk`'s
    // `atomic-write.d.ts` re-exports four symbols and declares only one, so several persistence
    // functions arrive typed as unresolved. They exist and work at runtime (measured). Filed
    // separately; typing the call site keeps this module honest in the meantime.
    const kind = (classifySessionArtifact as (n: string, d: boolean) => string | undefined)(
      entry,
      isDirectory,
    )
    if (kind !== 'transcript') continue
    found.push({ id: entry.replace(/\.jsonl$/, ''), transcript: path, modifiedAt })
  }
  return found.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime())
}

/**
 * Transcripts that must NOT be collected: the resumable pointer's target, the most recent session,
 * and anything holding a writer lease.
 *
 * Three reasons, deliberately not collapsed into a boolean. A caller reporting "skipped 4 sessions"
 * is far less useful than one reporting why each was skipped, and retention policy is exactly where
 * an operator asks that question.
 */
export function protectedTranscripts(
  cwd: string,
  root: string = transcriptRoot(),
): Map<string, string> {
  const protectedBy = new Map<string, string>()
  const sessions = listSessions(cwd, root)

  const pointer = readPointer(cwd, root)
  if (pointer !== undefined) protectedBy.set(pointer, 'resumable session pointer')

  // The most recent survives even without a pointer: it is what `--continue` would find, and a GC
  // that leaves a project with nothing to continue has destroyed the feature it was protecting.
  if (sessions.length > 0 && !protectedBy.has(sessions[0].id)) {
    protectedBy.set(sessions[0].id, 'most recent session')
  }

  for (const session of sessions) {
    // Third instance of the same upstream `.d.ts` gap (see `listSessions`). The predicate is real
    // and the negative test proves it fires — a live lease does refuse the delete.
    const hasWriter = (sessionHasWriter as (p: string) => boolean)(session.transcript)
    if (hasWriter) protectedBy.set(session.id, 'active writer lease')
  }
  return protectedBy
}

/** The pointer's target id, or `undefined`. Local because only protection reads it. */
function readPointer(cwd: string, root: string): string | undefined {
  try {
    const id = readFileSync(sessionPointerPath(cwd, root), 'utf8').trim()
    return id.length > 0 ? id : undefined
  } catch {
    return undefined
  }
}

/** What `deleteSession` did, per store. */
export interface DeleteSessionResult {
  /** Whether a registry entry was removed. */
  readonly registryRemoved: boolean
  /** Whether the transcript file was removed. */
  readonly transcriptRemoved: boolean
  /**
   * Why the registry removal failed, when it did.
   *
   * Kept SEPARATE from `registryRemoved` on purpose: collapsing the two outcomes into one boolean is
   * exactly how the original silent success hid. A caller that only checks `registryRemoved` sees
   * `false` and can still surface the reason.
   */
  readonly registryError?: unknown
}

export interface DeleteSessionOptions {
  readonly cwd: string
  readonly root?: string
  /** Delete even when protected. The refusal is the default because the damage is unrecoverable. */
  readonly force?: boolean
  /**
   * Remove the registry entry too. Injected (DIP) — the registry is the runtime's, not ours.
   *
   * T2.2 — MAY be async. `Agent.delete(id): Promise<void>` is the only agent registry in this
   * ecosystem, so a sync-only seam could be satisfied honestly by nobody. Returning `false` means
   * "no entry to remove" and is not a failure; THROWING (or rejecting) is, and it stops the delete
   * with the transcript still on disk.
   */
  readonly removeFromRegistry?: (sessionId: string) => unknown
  /**
   * Ceiling on the injected remover. A registry that never answers must not hang a sweep; the
   * timeout surfaces as `registryError` and the transcript is left alone.
   */
  readonly registryTimeoutMs?: number
}

/**
 * Delete a session, refusing by default when it is protected.
 *
 * The two stores are reported separately because they genuinely are separate — `Agent.delete`
 * touches only the registry, and a caller that assumed otherwise would leave the transcript behind
 * believing it gone. Returning one boolean would rebuild that confusion inside this function.
 *
 * @throws {SessionInUseError} when the session is protected and `force` is not set.
 */

export async function deleteSession(
  sessionId: string,
  options: DeleteSessionOptions,
): Promise<DeleteSessionResult> {
  const root = options.root ?? transcriptRoot()
  if (options.force !== true) {
    const reason = protectedTranscripts(options.cwd, root).get(sessionId)
    if (reason !== undefined) throw new SessionInUseError(sessionId, reason)
  }

  // The registry removal runs FIRST, and its result is inspected before anything is unlinked.
  //
  // `registryRemoved: options.removeFromRegistry?.(id) ?? false` used to sit at the return, and an
  // async remover made it lie: a Promise is truthy, so the field said the entry was gone before the
  // removal had happened, and a rejection surfaced as an unhandled rejection. That is not a corner —
  // the SDK's `Agent.delete` returns `Promise<void>` and is the ONLY agent registry in the ecosystem
  // (the sole sync `delete(name): boolean` in the SDK belongs to `Budget`). Every real caller has an
  // async remover, so the seam could not be satisfied honestly by anyone who tried.
  //
  // Refusing beats guessing: the transcript is still on disk, so the caller retries after awaiting
  // its own removal. Deleting the file and reporting a registry state that never happened is the one
  // outcome that cannot be undone.
  // ORDER IS THE INVARIANT (EC-3): registry first, unlink second.
  //
  // A registry failure after the unlink leaves an entry pointing at a transcript that is gone, and
  // nothing repairs it — GC works FROM transcripts, so it never sees the orphan entry again. The
  // reverse leaves an orphan FILE, which the next sweep collects. One failure mode is recoverable
  // and the other is not, so this is not a preference.
  let registryRemoved = false
  let registryError: unknown
  if (options.removeFromRegistry !== undefined) {
    try {
      // Awaiting is what the old refusal was reaching for. It rejected a thenable because the code
      // before it checked TRUTHINESS and reported a removal that had not happened; completion is
      // what fixes that, and completion is `await`.
      const outcome = await awaitRegistryRemoval(
        options.removeFromRegistry(sessionId),
        sessionId,
        options.registryTimeoutMs,
      )
      // `false` means "no entry to remove" — an ordinary outcome, not a failure. `void` (the shape
      // `Agent.delete` has) means it completed.
      registryRemoved = outcome !== false
    } catch (error) {
      // The transcript is untouched, so the caller can retry after fixing the registry. Deleting it
      // here would trade a retryable state for an unrepairable one.
      return { registryRemoved: false, transcriptRemoved: false, registryError: error }
    }
  }

  let transcriptRemoved = false
  try {
    rmSync(transcriptPath(root, options.cwd, sessionId))
    transcriptRemoved = true
  } catch {
    // Absent is the desired end state, so a missing file is not a failure — it is just `false`.
  }

  return { registryRemoved, transcriptRemoved, registryError }
}

/**
 * Fork `srcId` into `newId`, keeping everything BEFORE the `nth` user turn.
 *
 * Delegates the copy to the SDK's `forkTranscript` — the truncation rule is the SDK's knowledge and
 * re-deriving it here would give two answers to "where does a turn begin".
 *
 * `nth` is 1-based, matching how a person counts turns out loud. A 0-based index here would be a
 * silent off-by-one on a destructive-feeling operation.
 */
export function forkBeforeUserTurn(
  srcId: string,
  newId: string,
  nth: number,
  options: { readonly cwd: string; readonly root?: string },
): { readonly transcript: string; readonly recordIndex: number; readonly selectedText: string } {
  if (!Number.isInteger(nth) || nth < 1) {
    throw new TheokitAgentError(
      `forkBeforeUserTurn: \`nth\` counts user turns from 1, received ${String(nth)}.`,
    )
  }
  // Both ids resolve against the same root, so a self-fork would write the truncated copy OVER the
  // source — silent data loss on an operation whose whole point is to preserve the original. The
  // hazard was unreachable only because this function always threw; the count fix opens it.
  if (srcId === newId) {
    throw new TheokitAgentError(
      `forkBeforeUserTurn: srcId and newId must differ — forking "${srcId}" onto itself would ` +
        `truncate the source transcript in place.`,
    )
  }
  const root = options.root ?? transcriptRoot()
  const src = transcriptPath(root, options.cwd, srcId)
  const dst = transcriptPath(root, options.cwd, newId)

  const turns = reachableUserTurns(src)
  // Bounds, not a null check: `noUncheckedIndexedAccess` is off, so the element type lies about
  // out-of-range access and the linter flags the honest guard as unnecessary.
  if (nth > turns.length) {
    throw new TheokitAgentError(
      `forkBeforeUserTurn: session "${srcId}" has ${String(turns.length)} reachable user turn(s), ` +
        `so turn ${String(nth)} does not exist. "Reachable" excludes tool results, goal ` +
        `continuations, and anything before the last compaction boundary — those are records the ` +
        `user did not type or can no longer see.`,
    )
  }
  const selected = turns[nth - 1]

  // `liveSessionPaths` is the SDK's own guard against writing over a session in use, and it takes
  // the paths from the caller because only the caller knows which are live. This module computes
  // exactly that set, so passing it is not extra safety — it is the guard finally being fed.
  forkTranscript(src, dst, {
    beforeRecordIndex: selected.index,
    liveSessionPaths: [...protectedTranscripts(options.cwd, root).keys()].map((id) =>
      transcriptPath(root, options.cwd, id),
    ),
  })
  // `selectedText` so a surface can re-seed its composer with what the user typed. Returning only
  // an index forces every consumer to re-read the transcript to learn what it just selected — which
  // is what TheoCode's backtrack module had to do.
  return { transcript: dst, recordIndex: selected.index, selectedText: selected.text }
}

/**
 * A record the USER actually typed, after the last compaction boundary.
 *
 * Three exclusions, each one a way the naive count lands on the wrong turn (T2.3):
 *
 *  - **Tool results carry `type: 'user'`.** That is how the protocol frames them; nobody typed
 *    them, and "the 2nd thing I said" does not mean one.
 *  - **Goal continuations are synthetic.** The goal runner writes them, so counting them rewinds a
 *    user to a message they never sent.
 *  - **Records before the last `compact_boundary` have left the model's window.** Forking there
 *    silently rewinds past what the user can still see.
 *
 * The failure this closes is the worst shape available: the fork SUCCEEDS, at the wrong place, and
 * nothing errors. The consumer encoded all three corrections in its own backtrack module
 * (`TheoCode packages/agent/src/session/backtrack.ts:88-103`), which is the specification here.
 */
const GOAL_CONTINUATION_MARKER = '[[theokit:goal-continuation]]'

interface TranscriptRecord {
  readonly type?: string
  readonly subtype?: string
  readonly message?: { readonly content?: readonly { type?: string; text?: string }[] }
}

function textOfRecord(record: TranscriptRecord): string {
  return (record.message?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('')
}

function isGenuineUserTurn(record: TranscriptRecord): boolean {
  if (record.type !== 'user') return false
  const text = textOfRecord(record)
  if (text.length === 0) return false // tool results carry no text block
  return !text.startsWith(GOAL_CONTINUATION_MARKER)
}

/** Indices of the reachable user turns, in order, and the text of each. */
function reachableUserTurns(src: string): { index: number; text: string }[] {
  // `loadJsonl`, not `readTranscript`: the latter is declared on the SDK's internal transcript
  // module and is NOT on the `/persistence` surface. Reaching past the published entry to get it
  // would be the boundary violation this whole layer exists to remove — the same one the M67
  // measurement found a consumer committing six times.
  const records = loadJsonl<TranscriptRecord>(src) as readonly TranscriptRecord[]

  // The LAST boundary, not the first: an old transcript can carry several, and only the most recent
  // one describes what the model can still see.
  let floor = -1
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (records[i]?.type === 'system' && records[i]?.subtype === 'compact_boundary') {
      floor = i
      break
    }
  }

  const turns: { index: number; text: string }[] = []
  for (let i = floor + 1; i < records.length; i += 1) {
    const record = records[i]
    if (isGenuineUserTurn(record)) turns.push({ index: i, text: textOfRecord(record) })
  }
  return turns
}
