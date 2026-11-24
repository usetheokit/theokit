/* eslint-disable security/detect-non-literal-fs-filename --
 * Session lifecycle over the transcript root. Every path here is built from `transcriptRoot()` plus
 * a session id or an `encodeProjectDir` hash — never from HTTP input. The variable filename IS the
 * feature: a module whose job is listing and deleting sessions cannot address them by literal.
 */
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'

import { TheokitAgentError } from '@theokit/sdk/errors'
import {
  forkTranscript,
  legacyTranscriptPath,
  listSessions as sdkListSessions,
  loadJsonl,
  sessionHasWriter,
  transcriptPath,
  transcriptRoot,
} from '@theokit/sdk/persistence'
import type { SessionListing } from '@theokit/sdk/persistence'

// T2.2 follow-up — the bound lives in ONE place now. `SessionRegistryRemoverError` is re-exported
// because it was already public from this module: moving a symbol must not remove it from the
// surface, which would be a breaking change dressed as a refactor.
import {
  awaitRegistryRemoval,
  DEFAULT_REGISTRY_TIMEOUT_MS,
  SessionRegistryRemoverError,
} from './gc/registry-remover.js'
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
 * `{ registryOutcome, transcriptRemoved }` so the two are impossible to confuse, and a caller that
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
    /**
     * What the registry half reported before the refusal, or `undefined` when it never ran.
     *
     * Set only when the session became protected DURING the registry removal — the re-check fires
     * after the await, so that half has already been attempted while the transcript stays. The
     * caller needs it: retrying a removal that is already done reports "nothing to remove", which
     * reads as a failure and is not one.
     *
     * Carries the OUTCOME rather than a boolean since #675. `unconfirmed` must not be advertised as
     * "already removed" — that is the assertion the issue is about, and telling a caller not to
     * retry a half that may never have happened is the expensive direction to be wrong in.
     */
    readonly registryOutcome?: RegistryOutcome,
  ) {
    super(
      `session "${sessionId}" is protected (${reason}). Deleting it would discard state something ` +
        `is still using. Stop the run, or pass { force: true } to delete anyway.` +
        registryNote(registryOutcome),
    )
  }
}

/** The sentence the refusal adds about a registry half that already ran. Silent when it did not. */
function registryNote(outcome: RegistryOutcome | undefined): string {
  if (outcome === 'removed') {
    return ` The registry entry was already removed before this was noticed — do not retry that half, only the transcript.`
  }
  if (outcome === 'unconfirmed') {
    return ` The registry removal was already attempted and reported nothing, so whether the entry is gone is unknown — verify it before retrying.`
  }
  return ''
}

/**
 * One session listing entry. This IS the SDK's `SessionListing`: `id` is read from the transcript
 * (never from the filename), and `idSource` says whether it could be.
 */
export type SessionSummary = SessionListing

/**
 * Sessions under `cwd`'s project directory, most recent first. Delegates the scan to the SDK's
 * `listSessions` (the same listing `@theokit/agents/persistence` exports), then drops directories
 * named like a transcript and sorts newest first.
 */
export async function listSessions(
  cwd: string,
  root: string = transcriptRoot(),
): Promise<readonly SessionSummary[]> {
  const listed = await sdkListSessions(cwd, { baseDir: root })
  const found = listed.filter((entry) => {
    try {
      return !statSync(entry.transcript).isDirectory()
    } catch {
      return false // vanished between listing and stat — a concurrent delete
    }
  })
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
/**
 * RENAMED from `protectedTranscripts` by usetheokit/theokit#668, and the rename IS the fix for the
 * second half of that issue.
 *
 * The keys changed from session ids to transcript paths, and the signature did not:
 * `Map<string, string>` before and `Map<string, string>` after. A consumer that mapped the keys
 * forward through `transcriptPath` — the correct thing to do when they were ids — went on compiling
 * and started double-mapping, so its protection array matched nothing and its delete guard passed.
 * Measured on TheoCode against this very build: `deleteSession` collected a session with a LIVE
 * writer lease, and no type could have caught it.
 *
 * A silent break that loses data is worse than a loud one. The old name is GONE rather than aliased,
 * so a caller finds out at compile time instead of at delete time. Aliasing it would have preserved
 * exactly the silence this rename exists to remove.
 */
export async function protectedTranscriptPaths(
  cwd: string,
  root: string = transcriptRoot(),
): Promise<Map<string, string>> {
  const protectedBy = new Map<string, string>()
  const sessions = await listSessions(cwd, root)

  const pointer = readPointer(cwd, root)
  if (pointer !== undefined) {
    // Name the file(s) actually on disk (current and/or legacy naming); when neither exists, keep
    // both candidates so the protection stays fail-closed.
    const candidates = [
      transcriptPath(root, cwd, pointer),
      legacyTranscriptPath(root, cwd, pointer),
    ]
    const onDisk = candidates.filter((path) => existsSync(path))
    for (const path of onDisk.length > 0 ? onDisk : candidates) {
      protectedBy.set(path, 'resumable session pointer')
    }
  }

  // The most recent survives even without a pointer: it is what `--continue` would find, and a GC
  // that leaves a project with nothing to continue has destroyed the feature it was protecting.
  if (sessions.length > 0 && !protectedBy.has(sessions[0].transcript)) {
    protectedBy.set(sessions[0].transcript, 'most recent session')
  }

  for (const session of sessions) {
    // A live lease does refuse the delete; the negative test proves the predicate fires.
    const hasWriter = sessionHasWriter(session.transcript)
    if (hasWriter) protectedBy.set(session.transcript, 'active writer lease')
  }
  return protectedBy
}

/**
 * The transcript a session id would occupy, for keying protection.
 *
 * Protection runs id → PATH and never the reverse, because that is the direction with a function:
 * `transcriptPath` is total on both majors, while 5.x's naming is a one-way hash. Keying on the id
 * meant a transcript nobody could read could not be matched against anything, so a session someone
 * had DECLARED protected became collectable (usetheokit/theokit#668).
 */
export function transcriptOf(id: string, cwd: string, root: string = transcriptRoot()): string {
  return transcriptPath(root, cwd, id)
}

/**
 * The `last-session` pointer exists but cannot be read, so which session it protects is unknown.
 * Raised by the protection set (and so by `deleteSession`, `forkSession` and the collectors) instead
 * of treating the pointer as absent.
 */
export class SessionPointerUnreadableError extends TheokitAgentError {
  override readonly name = 'SessionPointerUnreadableError'

  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(
      `cannot read the last-session pointer at ${path} — refusing, because the session it names ` +
        `must not be deleted: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause, code: 'session_pointer_unreadable', isRetryable: false },
    )
  }
}

/**
 * The pointer's target id, or `undefined` when there is no pointer (`ENOENT`, or an empty file).
 * Any other read failure throws {@link SessionPointerUnreadableError}: the pointer decides what is
 * protected, so "could not read it" must refuse rather than read as "no pointer".
 */
function readPointer(cwd: string, root: string): string | undefined {
  const file = sessionPointerPath(cwd, root)
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new SessionPointerUnreadableError(file, err)
  }
  const id = raw.trim()
  return id.length > 0 ? id : undefined
}

/** What `deleteSession` did, per store. */
/**
 * What the injected registry remover actually told us — REPLACES the `registryRemoved` boolean
 * (usetheokit/theokit#675).
 *
 * There are three outcomes and a boolean could carry two, so the third was folded into `true`:
 *
 * - `removed`            the remover reported that it removed an entry
 * - `nothing-to-remove`  the remover reported that there was none — a report, and an ordinary one
 * - `unconfirmed`        the remover ran, resolved, and said NOTHING
 * - `failed`             it threw or timed out; see `registryError`
 * - `not-attempted`      no remover was supplied, so the registry was never touched
 *
 * `not-attempted` and `unconfirmed` are deliberately not the same value. "Nobody asked" and "we
 * asked and got silence" lead a caller to opposite actions, and the old boolean said `false` to
 * both.
 *
 * `unconfirmed` is the one that matters, and it is the common case rather than an exotic one.
 * `Agent.delete` returns `Promise<void>`: measured in `@theokit/sdk@4.52.1` and confirmed by the
 * SDK's changelog for `5.3.1`, it mutates an in-memory map and — unlike `Agent.list` — never
 * hydrates from disk, so in any freshly started process it resolves having removed nothing and
 * throws nothing. Reporting that as a removal was this package asserting something no version below
 * 5.3.1 gives it any way to know.
 *
 * `5.3.1` fixes the BEHAVIOUR and not the signature: `Agent.delete` still returns `Promise<void>`,
 * so `unconfirmed` stays the honest answer on every version this package admits. Raising the floor
 * would make the removal actually happen; it would not make it reportable, which is why the two are
 * separate decisions.
 *
 * A caller that needs certainty verifies from its own side; this package deliberately does not own
 * the registry (see `gc/registry-remover.ts`). `Agent.list` hydrates from disk — which `delete`
 * never does, and that asymmetry IS the upstream defect — so it is the read that can answer.
 */
export type RegistryOutcome =
  | 'removed'
  | 'nothing-to-remove'
  | 'unconfirmed'
  | 'failed'
  | 'not-attempted'
  /** Only with `isListedInRegistry`: the id was still listed after the removal ran. */
  | 'still-present'

export interface DeleteSessionResult {
  /**
   * What the registry remover reported. RENAMED from `registryRemoved` by #675: the meaning
   * changed, and a boolean under the old name would have kept `if (result.registryRemoved)`
   * compiling while silently flipping which branch it took.
   */
  readonly registryOutcome: RegistryOutcome
  /** Whether the transcript file was removed. */
  readonly transcriptRemoved: boolean
  /**
   * Why the registry removal failed, when it did.
   *
   * Kept SEPARATE from `registryOutcome` on purpose: collapsing the outcomes into one value is
   * exactly how the original silent success hid. A caller that only reads the outcome sees
   * `failed` and can still surface the reason.
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
  /**
   * Answers "is this id listed in the registry right now", e.g. `Agent.list` filtered by id. When
   * given, `deleteSession` calls it before and after `removeFromRegistry` and derives
   * `registryOutcome` from the two answers: listed after is `still-present`, not listed before is
   * `nothing-to-remove`, listed before and not after is `removed`. A verifier that throws or
   * exceeds `registryTimeoutMs` gives `unconfirmed` with the error in `registryError`; the
   * transcript step still runs. Never called without `removeFromRegistry`.
   */
  readonly isListedInRegistry?: (sessionId: string) => Promise<boolean>
}

interface ListingRead {
  readonly listed?: boolean
  readonly error?: unknown
}

/** One verifier read that reports its failure instead of throwing; absent verifier reads nothing. */
async function tryRead(
  verify: ((sessionId: string) => Promise<boolean>) | undefined,
  sessionId: string,
  timeoutMs: number | undefined,
): Promise<ListingRead> {
  if (verify === undefined) return {}
  try {
    return { listed: await readListed(verify, sessionId, timeoutMs) }
  } catch (error) {
    return { error }
  }
}

function classifyListings(
  before: boolean | undefined,
  after: boolean | undefined,
): RegistryOutcome {
  if (before === undefined || after === undefined) return 'unconfirmed'
  if (after) return 'still-present'
  return before ? 'removed' : 'nothing-to-remove'
}

/** Run one verifier read under the registry timeout; a timeout rejects with a verifier-specific error. */
async function readListed(
  verify: (sessionId: string) => Promise<boolean>,
  sessionId: string,
  timeoutMs: number | undefined = DEFAULT_REGISTRY_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const read = Promise.resolve().then(() => verify(sessionId))
    if (!Number.isFinite(timeoutMs)) return await read
    return await Promise.race([
      read,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new TheokitAgentError(
              `isListedInRegistry did not answer for session "${sessionId}" within ${String(timeoutMs)}ms.`,
            ),
          )
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
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
    // Protection is path-keyed so an unreadable transcript can still be matched (#668); the caller
    // speaks in ids, so the id is mapped forward here rather than the map being keyed backwards.
    const reason = (await protectedTranscriptPaths(options.cwd, root)).get(
      transcriptOf(sessionId, options.cwd, root),
    )
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
  // Starts at the honest default: with no remover supplied, the registry is never touched. Every
  // other value requires a remover to have RUN (usetheokit/theokit#675).
  let registryOutcome: RegistryOutcome = 'not-attempted'
  let registryError: unknown
  if (options.removeFromRegistry !== undefined) {
    const verify = options.isListedInRegistry
    const before = await tryRead(verify, sessionId, options.registryTimeoutMs)
    try {
      // Awaiting is what the old refusal was reaching for. It rejected a thenable because the code
      // before it checked TRUTHINESS and reported a removal that had not happened; completion is
      // what fixes that, and completion is `await`.
      const outcome = await awaitRegistryRemoval(
        options.removeFromRegistry(sessionId),
        sessionId,
        options.registryTimeoutMs,
      )
      // Three answers, and the third is silence. `false` is a REPORT that there was nothing —
      // ordinary, not a failure. Anything else truthy is a report that something went. `undefined`
      // is the shape `Agent.delete` has, and it says nothing at all: below `@theokit/sdk@5.3.1` it
      // is what a no-op returns, so folding it into "removed" asserted a fact nobody had (#675).
      if (outcome === false) registryOutcome = 'nothing-to-remove'
      else if (outcome === undefined) registryOutcome = 'unconfirmed'
      else registryOutcome = 'removed'
      if (verify !== undefined) {
        // The remover's own return value is replaced by the measured answer. A failed read on
        // either side leaves nothing to measure, so it is `unconfirmed` with the error kept.
        const after =
          before.error === undefined
            ? await tryRead(verify, sessionId, options.registryTimeoutMs)
            : before
        registryError = after.error
        registryOutcome = classifyListings(before.listed, after.listed)
      }
    } catch (error) {
      // The transcript is untouched, so the caller can retry after fixing the registry. Deleting it
      // here would trade a retryable state for an unrepairable one.
      return { registryOutcome: 'failed', transcriptRemoved: false, registryError: error }
    }
  }

  // RE-CHECK (invariant 4, borrowed from the sweep that already states it): the protection read at
  // the top of this function was a SNAPSHOT, and control has since left for as long as the caller's
  // registry remover took — 30s by default, unbounded when `registryTimeoutMs` is `Infinity`. A user
  // who resumes the session during that window makes the snapshot false, and unlinking on it deletes
  // the transcript of a session someone just returned to, which is the exact outcome
  // `SessionInUseError` exists to prevent.
  //
  // `transcript-gc.ts` treats this as non-negotiable for the BATCH path ("a collector that trusts
  // its own plan deletes the session someone just returned to"). The single-session path skipped it,
  // and it is the path with no later sweep to notice the mistake.
  //
  // Refusing here leaves the registry entry gone and the file present — an orphan FILE, which is the
  // recoverable direction this function already chose in the ordering comment above, and the reason
  // the error carries `registryOutcome`.
  if (options.force !== true) {
    const nowProtected = (await protectedTranscriptPaths(options.cwd, root)).get(
      transcriptOf(sessionId, options.cwd, root),
    )
    if (nowProtected !== undefined) {
      throw new SessionInUseError(sessionId, nowProtected, registryOutcome)
    }
  }

  let transcriptRemoved = false
  try {
    rmSync(transcriptPath(root, options.cwd, sessionId))
    transcriptRemoved = true
  } catch {
    // Absent is the desired end state, so a missing file is not a failure — it is just `false`.
  }

  return { registryOutcome, transcriptRemoved, registryError }
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
export async function forkBeforeUserTurn(
  srcId: string,
  newId: string,
  nth: number,
  options: { readonly cwd: string; readonly root?: string },
): Promise<{
  readonly transcript: string
  readonly recordIndex: number
  readonly selectedText: string
}> {
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
    // The keys are already transcript paths; mapping them through `transcriptPath` again would
    // build paths that match nothing and the SDK guard would never fire.
    liveSessionPaths: [...(await protectedTranscriptPaths(options.cwd, root)).keys()],
  })
  // `selectedText` so a surface can re-seed its composer with what the user typed. Returning only
  // an index forces every consumer to re-read the transcript to learn what it just selected — which
  // is what TheoCode's backtrack module had to do.
  return { transcript: dst, recordIndex: selected.index, selectedText: selected.text }
}

/** One user turn a backtrack UI can offer. */
export interface UserTurnPreview {
  /** 1-based, the same number `forkBeforeUserTurn` takes. */
  nth: number
  text: string
}

/**
 * List the user turns `forkBeforeUserTurn` can cut before, using the same rule and the same read
 * (`reachableUserTurns`), so entry `nth` here is the turn that `nth` selects there.
 *
 * A missing transcript resolves to `[]`. A torn last line is tolerated by the shared read.
 */
export async function listUserTurns(
  sessionId: string,
  options: { readonly cwd: string; readonly root?: string },
): Promise<readonly UserTurnPreview[]> {
  const path = transcriptPath(options.root ?? transcriptRoot(), options.cwd, sessionId)
  try {
    await stat(path)
  } catch {
    return []
  }
  return reachableUserTurns(path).map((turn, i) => ({ nth: i + 1, text: turn.text }))
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
  //
  // A live transcript can end in a half-written line (the writer is mid-append, or died mid-append).
  // Tolerate that LAST line only; corruption in the middle of the file still throws.
  const records = loadJsonl<TranscriptRecord>(src, {
    tolerateTrailingPartialLine: true,
  }) as readonly TranscriptRecord[]

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
