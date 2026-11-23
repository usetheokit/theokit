import { rmSync } from 'node:fs'

import { TheokitAgentError } from '@theokit/sdk/errors'
import { legacyTranscriptPath, transcriptPath, transcriptRoot } from '@theokit/sdk/persistence'

import { listSessions, protectedTranscriptPaths, transcriptOf } from '../session-lifecycle.js'

import { awaitRegistryRemoval } from './registry-remover.js'

/**
 * M72 — transcript retention: plan, then apply.
 *
 * ## Why this exists
 *
 * The framework ships everything that CREATES unbounded disk state — `transcriptPath`,
 * `appendJsonl`, `forkTranscript` — and nothing that bounded it. A product built on it either grows
 * transcripts forever or writes its own collector, and the one that did wrote 857 lines.
 *
 * The SDK draws the line explicitly in `classifySessionArtifact`'s docblock: *"This is deliberately
 * NOT a garbage collector. Retention is policy — how many days, how many to keep, which session is
 * live, whether to delete at all — and policy belongs to the application."* This module is that
 * policy, in the framework, so the application does not have to invent it.
 *
 * ## The four invariants
 *
 * This code DELETES a user's conversation history. The milestone's named top risk is that a GC wipes
 * a live transcript, and the mitigation it chose was not review but these four, each with a test:
 *
 * 1. **A floor violation is refused, never normalised.** Clamping is the tempting behaviour and the
 *    dangerous one: an operator who asked for a policy gets silently given a different one.
 * 2. **No mtime means never collect.** A file whose age cannot be read cannot be shown to be old;
 *    defaulting it to collectable treats missing evidence as evidence.
 * 3. **An active writer lease protects its transcript**, whatever the policy says.
 * 4. **The apply phase re-checks.** A plan is a snapshot, and between snapshot and delete a user can
 *    resume a session. A collector that trusts its own plan deletes the session someone just
 *    returned to.
 *
 * `apply` is never the default. A dry run prints what WOULD go, which is the only way an operator
 * can review a destructive policy before it runs.
 */

/** The smallest policy that still leaves a project resumable. */
const FLOOR = { keepLast: 1, maxAgeDays: 1 } as const

/** Raised when a retention knob is below its floor. Refusing beats clamping — see invariant 1. */
/**
 * The injected protection provider could not answer, so the run refuses to collect anything.
 *
 * Its OWN class and not a `GCFloorError`: that one means "a retention knob is below its floor", a
 * caller mistake fixed by passing a different number. This one means "we cannot know which sessions
 * are live" — different cause, different remedy, and collapsing them would make a diagnostic lie.
 * Not retryable: the provider is the caller's, and the same call reproduces the same failure.
 */
export class GCProtectionUnavailableError extends TheokitAgentError {
  override readonly name = 'GCProtectionUnavailableError'

  constructor(readonly reason: unknown) {
    super(
      `transcript GC: the injected protection provider threw, so this run cannot know which ` +
        `sessions are live and refuses to collect any. Refusing beats collecting blind — a guard ` +
        `that fails open on its own error is worse than no guard, because it reads as protection. ` +
        `Cause: ${reason instanceof Error ? reason.message : String(reason)}`,
      { code: 'gc_protection_unavailable', isRetryable: false, cause: reason },
    )
  }
}

export class GCFloorError extends TheokitAgentError {
  override readonly name = 'GCFloorError'

  constructor(
    readonly field: 'keepLast' | 'maxAgeDays',
    readonly received: number,
  ) {
    super(
      `transcript GC: \`${field}\` must be at least ${String(FLOOR[field])}, received ` +
        `${String(received)}. This is refused rather than clamped: a policy silently replaced by a ` +
        `different one is a policy nobody reviewed.`,
    )
  }
}

/** A transcript the policy would collect. */
export interface GCCandidate {
  /** `undefined` when the transcript could not be read — see `SessionSummary.id` (#668). */
  readonly id: string | undefined
  readonly transcript: string
  readonly modifiedAt: Date
  /**
   * Whether the session id could be read from inside the transcript. Absent means `id !== undefined`.
   * An `id` of `undefined` with this `true` is a file no known session owns (a fork of nobody's).
   */
  readonly idReadable?: boolean
}

/** What a protection predicate is asked about: one transcript, by its real file. */
export interface GCSession {
  /** The session that OWNS this file (by its current or legacy name), or `undefined` when none. */
  readonly id: string | undefined
  readonly transcript: string
  /** `false` when the transcript could not be read at all. */
  readonly idReadable: boolean
}

/** Answer a protection reason when the session must stay, `undefined` when policy may collect it. */
export type GCProtectionPredicate = (session: GCSession) => string | undefined

/** A transcript the policy keeps, and why. */
export interface GCKept {
  /** `undefined` when the transcript could not be read — see `SessionSummary.id` (#668). */
  readonly id: string | undefined
  /** Human-readable protection reason — recency, policy, lease, or unreadable age. */
  readonly reason: string
}

export interface TranscriptGCOptions {
  readonly cwd: string
  /** Newest N sessions always survive. Floor: 1 — a project with none has nothing to `--continue`. */
  readonly keepLast: number
  /** Only sessions older than this may be collected. Floor: 1. */
  readonly maxAgeDays: number
  readonly root?: string
  /** Injected clock (DIP) — a live `Date.now()` makes every age assertion depend on run speed. */
  readonly now?: number
  /**
   * Extra sessions this framework cannot see are live.
   *
   * `protectedTranscriptPaths` derives protection from THIS framework's pointer convention. A consumer
   * whose live-session registry lives elsewhere gets an INERT guard — silently, inside a guard that
   * deletes user transcripts. That is the shape of the consumer's own PS-002: declared, wired, never
   * called, and therefore reading as protection while protecting nothing.
   *
   * ADDITIVE ONLY. The returned ids are unioned with the built-in ones and can never remove them: a
   * seam that could unprotect a session the framework knows is live would be a deletion vector, not
   * a safety net.
   *
   * A provider that THROWS refuses the whole run — matching `GCFloorError`'s refuse-don't-clamp
   * posture, and deliberately not reproducing the consumer's fail-open bug where an EACCES on the
   * pointer read became "there is no live session".
   */
  readonly protectedIds?: () => ReadonlyMap<string, string>
  /**
   * Protection as a rule rather than a list (for example "retired generations nobody holds").
   * Asked about every transcript by its real file, so a fork or a legacy-named file is judged as
   * itself. Same additive, fail-closed contract as `protectedIds`: a throw refuses the run, and it
   * is asked again when the plan is applied.
   */
  readonly isProtected?: GCProtectionPredicate
  /**
   * Every session id the caller's registry knows (archived ones included). A transcript is named
   * by the id whose current or legacy file it is; without this a fork, whose rows name its SOURCE,
   * is only named when the id inside it is the one its file is named for.
   */
  readonly knownIds?: () => Iterable<string>
}

export interface TranscriptGCPlan {
  readonly cwd: string
  readonly root: string
  readonly candidates: readonly GCCandidate[]
  readonly kept: readonly GCKept[]
}

/**
 * Decide what a retention policy would collect, without touching anything.
 *
 * Both conditions must hold for a transcript to be a candidate: beyond `keepLast` in recency order
 * AND older than `maxAgeDays`. Age alone would delete a project's whole recent history the moment it
 * exceeded the count; count alone would delete yesterday's work on a busy project.
 *
 * @throws {GCFloorError} when a knob is below its floor (invariant 1).
 */
/**
 * Union the built-in protection with whatever the consumer contributes.
 *
 * Built-in entries win on key collision: the framework's reason for keeping a session is not
 * something an injected map may relabel away.
 */
function resolveProtection(
  builtin: ReadonlyMap<string, string>,
  provider: (() => ReadonlyMap<string, string>) | undefined,
  cwd: string,
  root: string,
): ReadonlyMap<string, string> {
  if (provider === undefined) return builtin
  let extra: ReadonlyMap<string, string>
  try {
    extra = provider()
  } catch (cause) {
    throw new GCProtectionUnavailableError(cause)
  }
  // The caller speaks in session ids, which is the vocabulary it has; protection is matched on
  // transcript paths, which is the only key an unreadable transcript can still answer to. The
  // translation happens HERE, once, in the direction that has a function (usetheokit/theokit#668).
  const union = new Map<string, string>()
  for (const [id, reason] of extra) {
    union.set(transcriptOf(id, cwd, root), reason)
    union.set(legacyTranscriptPath(root, cwd, id), reason)
  }
  for (const [path, reason] of builtin) union.set(path, reason)
  return union
}

/** Ask a predicate, refusing the run when it cannot answer. */
function ask(predicate: GCProtectionPredicate | undefined, session: GCSession): string | undefined {
  if (predicate === undefined) return undefined
  try {
    return predicate(session)
  } catch (cause) {
    throw new GCProtectionUnavailableError(cause)
  }
}

/** The id whose current or legacy file this is: a known id first, else the id the file records. */
function ownerOf(
  transcript: string,
  contentId: string | undefined,
  known: ReadonlyMap<string, string>,
  cwd: string,
  root: string,
): string | undefined {
  const registered = known.get(transcript)
  if (registered !== undefined) return registered
  if (contentId === undefined) return undefined
  return transcriptPath(root, cwd, contentId) === transcript ||
    legacyTranscriptPath(root, cwd, contentId) === transcript
    ? contentId
    : undefined
}

function knownPaths(
  ids: Iterable<string> | undefined,
  cwd: string,
  root: string,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>()
  if (ids === undefined) return out
  for (const id of ids) {
    out.set(transcriptPath(root, cwd, id), id)
    out.set(legacyTranscriptPath(root, cwd, id), id)
  }
  return out
}

export async function planTranscriptGC(options: TranscriptGCOptions): Promise<TranscriptGCPlan> {
  if (!Number.isFinite(options.keepLast) || options.keepLast < FLOOR.keepLast) {
    throw new GCFloorError('keepLast', options.keepLast)
  }
  if (!Number.isFinite(options.maxAgeDays) || options.maxAgeDays < FLOOR.maxAgeDays) {
    throw new GCFloorError('maxAgeDays', options.maxAgeDays)
  }

  const root = options.root ?? transcriptRoot()
  const now = options.now ?? Date.now()
  const cutoff = now - options.maxAgeDays * 86_400_000

  const sessions = await listSessions(options.cwd, root) // newest first
  const protectedBy = resolveProtection(
    await protectedTranscriptPaths(options.cwd, root),
    options.protectedIds,
    options.cwd,
    root,
  )

  let known: ReadonlyMap<string, string>
  try {
    known = knownPaths(options.knownIds?.(), options.cwd, root)
  } catch (cause) {
    throw new GCProtectionUnavailableError(cause)
  }

  const candidates: GCCandidate[] = []
  const kept: GCKept[] = []

  for (const [index, listed] of sessions.entries()) {
    const idReadable = listed.id !== undefined
    const owner = ownerOf(listed.transcript, listed.id, known, options.cwd, root)
    const session = { ...listed, id: owner }
    const protection =
      protectedBy.get(session.transcript) ??
      ask(options.isProtected, { id: owner, transcript: session.transcript, idReadable })
    if (protection !== undefined) {
      kept.push({ id: session.id, reason: protection }) // invariant 3, plus pointer/most-recent
      continue
    }
    if (index < options.keepLast) {
      kept.push({ id: session.id, reason: `within the newest ${String(options.keepLast)}` })
      continue
    }
    // Invariant 2. `listSessions` drops an entry it cannot `stat`, so an unreadable mtime never
    // reaches here as a candidate — but an INVALID date could, and every comparison against `NaN`
    // is false, which would silently make the file collectable. Checking is one line; the failure
    // mode it prevents is unrecoverable.
    const age = session.modifiedAt.getTime()
    if (Number.isNaN(age)) {
      kept.push({ id: session.id, reason: 'modification time unreadable — age cannot be shown' })
      continue
    }
    if (age >= cutoff) {
      kept.push({ id: session.id, reason: `younger than ${String(options.maxAgeDays)} days` })
      continue
    }
    candidates.push({
      id: session.id,
      transcript: session.transcript,
      modifiedAt: session.modifiedAt,
      idReadable,
    })
  }

  return { cwd: options.cwd, root, candidates, kept }
}

/** What one candidate's removal did, or why it did not. */
export interface GCError {
  /** `undefined` when the failure IS that no id could be read (#668). */
  readonly id: string | undefined
  readonly message: string
}

export interface RunTranscriptGCResult {
  readonly dryRun: boolean
  /** Ids that were (or, in a dry run, would be) removed. */
  readonly removed: readonly string[]
  /**
   * Transcripts collected whose session id could NOT be read, by path.
   *
   * A separate list rather than a second meaning inside `removed`: that one answers "which sessions
   * did I collect", this one answers "which files did I collect that I could not name". Folding them
   * together would put two kinds of string in one array and make every consumer guess which it held
   * (usetheokit/theokit#668).
   */
  readonly orphaned: readonly string[]
  /** One entry per candidate that failed — the rest still ran. */
  readonly errors: readonly GCError[]
}

/**
 * Execute a plan. `apply: false` reports what would happen and changes nothing.
 *
 * Errors accumulate PER CANDIDATE (fail-open): one undeletable file must not leave the rest of the
 * disk uncollected, and the operator must still learn which one failed. `ENOENT` counts as success —
 * absent is the desired end state, and reporting it as failure would make the second run of an
 * interrupted GC look broken.
 */
/** What the registry half decided for one candidate: a note to report, and whether to unlink. */
interface RegistryOutcome {
  readonly note?: GCError
  readonly unlink: boolean
}

/**
 * Take the registry half for one candidate, before anything is unlinked.
 *
 * Registry first (EC-3). A failure here SKIPS the unlink: an orphan transcript is collected next
 * sweep, an orphan registry entry is collected by nothing.
 *
 * A candidate with no id is the other outcome, and it is not a failure: the transcript is still
 * collected, and what stops is asserting an identity nobody read. Passing the filename instead was
 * the second half of usetheokit/theokit#668 — the file was unlinked and the removal named a session
 * that never existed.
 */
async function releaseFromRegistry(
  candidate: GCCandidate,
  options: {
    readonly removeFromRegistry?: (id: string) => unknown
    readonly registryTimeoutMs?: number
  },
): Promise<RegistryOutcome> {
  if (candidate.id === undefined) {
    return { note: { id: undefined, message: UNNAMEABLE_COLLECTION }, unlink: true }
  }
  if (options.removeFromRegistry === undefined) return { unlink: true }
  try {
    // Bounded by the SAME helper `deleteSession` uses. The first implementation of this seam used a
    // bare `await`, and the consequence was not a style point: a registry that never answered hung
    // the entire sweep — not this session, every session after it, with no error and no output. The
    // single-session path was already tested against exactly that; the path that runs unattended
    // over a whole project was not.
    await awaitRegistryRemoval(
      options.removeFromRegistry(candidate.id),
      candidate.id,
      options.registryTimeoutMs,
    )
    return { unlink: true }
  } catch (error) {
    return {
      note: {
        id: candidate.id,
        message: `registry removal failed, transcript kept: ${(error as Error).message}`,
      },
      unlink: false,
    }
  }
}

/** Why a collected transcript reached no registry: see the call site and usetheokit/theokit#668. */
const UNNAMEABLE_COLLECTION =
  'transcript collected without a registry removal: its session id could not be read, and a fabricated one would name no session'

/**
 * Record a collection under the list that can name it. Extracted because the ENOENT path and the
 * success path must agree: a transcript already gone is still collected, and still unnameable if its
 * id was never read (usetheokit/theokit#668).
 */
function recordRemoval(candidate: GCCandidate, removed: string[], orphaned: string[]): void {
  if (candidate.id === undefined) orphaned.push(candidate.transcript)
  else removed.push(candidate.id)
}

export async function runTranscriptGC(
  plan: TranscriptGCPlan,
  options: {
    readonly apply: boolean
    /** Same additive, fail-closed contract as on the plan — see `TranscriptGCOptions.protectedIds`. */
    readonly protectedIds?: () => ReadonlyMap<string, string>
    /** Same contract as on the plan — asked again here, about each candidate as it is now. */
    readonly isProtected?: GCProtectionPredicate
    /**
     * T2.2 — remove the registry entry as well as the transcript file.
     *
     * Without it this function deleted transcripts and left the agent registry pointing at files
     * that no longer exist. Nothing repaired that: GC works FROM transcripts, so an entry whose
     * transcript is gone is never seen again. `deleteSession` has had this seam; the sweep did not.
     *
     * Same contract as `deleteSession`: may be async (`Agent.delete` is the only registry there is),
     * runs BEFORE the unlink, and a throw leaves the transcript on disk for the next sweep rather
     * than producing an entry no run can repair.
     */
    readonly removeFromRegistry?: (sessionId: string) => unknown
    /**
     * How long to wait for the registry per session before giving up on it and keeping the
     * transcript. Absent means wait indefinitely — the pre-existing behaviour, kept as the default
     * so adding the bound cannot change what a current caller experiences.
     */
    readonly registryTimeoutMs?: number
  },
): Promise<RunTranscriptGCResult> {
  const removed: string[] = []
  const orphaned: string[] = []
  const errors: GCError[] = []

  // Invariant 4 — the TOCTOU backstop. The plan is a snapshot; between snapshot and delete a user
  // can resume a session or a process can take a lease. Re-reading protection HERE is what turns
  // "was safe when we looked" into "is safe now".
  const protectedNow = options.apply
    ? resolveProtection(
        await protectedTranscriptPaths(plan.cwd, plan.root),
        options.protectedIds,
        plan.cwd,
        plan.root,
      )
    : new Map<string, string>()

  for (const candidate of plan.candidates) {
    if (protectedNow.has(candidate.transcript)) continue // became live after planning — leave it
    if (
      options.apply &&
      ask(options.isProtected, {
        id: candidate.id,
        transcript: candidate.transcript,
        idReadable: candidate.idReadable ?? candidate.id !== undefined,
      }) !== undefined
    ) {
      continue
    }

    if (!options.apply) {
      if (candidate.id === undefined) orphaned.push(candidate.transcript)
      else removed.push(candidate.id)
      continue
    }
    const registry = await releaseFromRegistry(candidate, options)
    if (registry.note !== undefined) errors.push(registry.note)
    if (!registry.unlink) continue
    try {
      // The path the plan FOUND, not one re-derived from the id. Re-deriving it asked the same
      // reverse question that #668 is about, and it can only ever agree with `candidate.transcript`
      // when the id was readable — which is exactly the case where it was redundant.
      rmSync(candidate.transcript)
      recordRemoval(candidate, removed, orphaned)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        recordRemoval(candidate, removed, orphaned)
        continue
      }
      errors.push({ id: candidate.id, message: (error as Error).message })
    }
  }

  return { dryRun: !options.apply, removed, orphaned, errors }
}
