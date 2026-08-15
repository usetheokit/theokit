import { rmSync } from 'node:fs'

import { TheokitAgentError } from '@theokit/sdk/errors'
import { transcriptPath, transcriptRoot } from '@theokit/sdk/persistence'

import { listSessions, protectedTranscripts } from '../session-lifecycle.js'

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
  readonly id: string
  readonly transcript: string
  readonly modifiedAt: Date
}

/** A transcript the policy keeps, and why. */
export interface GCKept {
  readonly id: string
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
   * `protectedTranscripts` derives protection from THIS framework's pointer convention. A consumer
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
): ReadonlyMap<string, string> {
  if (provider === undefined) return builtin
  let extra: ReadonlyMap<string, string>
  try {
    extra = provider()
  } catch (cause) {
    throw new GCProtectionUnavailableError(cause)
  }
  const union = new Map(extra)
  for (const [id, reason] of builtin) union.set(id, reason)
  return union
}

export function planTranscriptGC(options: TranscriptGCOptions): TranscriptGCPlan {
  if (!Number.isFinite(options.keepLast) || options.keepLast < FLOOR.keepLast) {
    throw new GCFloorError('keepLast', options.keepLast)
  }
  if (!Number.isFinite(options.maxAgeDays) || options.maxAgeDays < FLOOR.maxAgeDays) {
    throw new GCFloorError('maxAgeDays', options.maxAgeDays)
  }

  const root = options.root ?? transcriptRoot()
  const now = options.now ?? Date.now()
  const cutoff = now - options.maxAgeDays * 86_400_000

  const sessions = listSessions(options.cwd, root) // newest first
  const protectedBy = resolveProtection(
    protectedTranscripts(options.cwd, root),
    options.protectedIds,
  )

  const candidates: GCCandidate[] = []
  const kept: GCKept[] = []

  for (const [index, session] of sessions.entries()) {
    const protection = protectedBy.get(session.id)
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
    })
  }

  return { cwd: options.cwd, root, candidates, kept }
}

/** What one candidate's removal did, or why it did not. */
export interface GCError {
  readonly id: string
  readonly message: string
}

export interface RunTranscriptGCResult {
  readonly dryRun: boolean
  /** Ids that were (or, in a dry run, would be) removed. */
  readonly removed: readonly string[]
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
export function runTranscriptGC(
  plan: TranscriptGCPlan,
  options: {
    readonly apply: boolean
    /** Same additive, fail-closed contract as on the plan — see `TranscriptGCOptions.protectedIds`. */
    readonly protectedIds?: () => ReadonlyMap<string, string>
  },
): RunTranscriptGCResult {
  const removed: string[] = []
  const errors: GCError[] = []

  // Invariant 4 — the TOCTOU backstop. The plan is a snapshot; between snapshot and delete a user
  // can resume a session or a process can take a lease. Re-reading protection HERE is what turns
  // "was safe when we looked" into "is safe now".
  const protectedNow = options.apply
    ? resolveProtection(protectedTranscripts(plan.cwd, plan.root), options.protectedIds)
    : new Map<string, string>()

  for (const candidate of plan.candidates) {
    if (protectedNow.has(candidate.id)) continue // became live after planning — leave it alone

    if (!options.apply) {
      removed.push(candidate.id)
      continue
    }
    try {
      rmSync(transcriptPath(plan.root, plan.cwd, candidate.id))
      removed.push(candidate.id)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        removed.push(candidate.id)
        continue
      }
      errors.push({ id: candidate.id, message: (error as Error).message })
    }
  }

  return { dryRun: !options.apply, removed, errors }
}
