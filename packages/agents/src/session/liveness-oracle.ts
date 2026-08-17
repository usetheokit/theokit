/**
 * Does the project behind `projects/<encoded>/` still exist?
 *
 * The question is hard because of a decision this package's layout made:
 * `encodeProjectDir(cwd)` is `cwd.replace(/[^a-zA-Z0-9]/g, '-')`, a one-way street. `/a/b` and
 * `/a-b` produce the same name, so a directory name cannot be turned back into a path — it can only
 * be CHECKED against candidates. Every product that retains or garbage-collects transcripts has to
 * answer this, and until now each one wrote the search itself: the consumer's 188 lines, whose own
 * docstring measured 13.269 project directories, ~3.200 falling through to filesystem search, and
 * ~64M syscalls without a shared budget.
 *
 * ## What is injected, and why exactly that
 *
 * `candidatePaths` — which directories are even candidates is PRODUCT policy (workspaces, ignore
 * rules, mounted volumes). This module must not guess it. It returns REAL ABSOLUTE PATHS, and the
 * name says so because the previous one (`listProjects`) did not: the only consumer's function of
 * that name returns ENCODED DIRECTORY NAMES, and wiring one to the other classified 6 of 6 live
 * projects `dead`.
 *
 * `fs` — so the budget is countable and the caller can supply a stat that matches its own retry and
 * timeout posture. Every call is one operation.
 *
 * What is NOT injected is the encoding, because that is the thing this package owns and the whole
 * reason the question exists.
 *
 * ## Two properties do the work
 *
 * **The result is three-valued and `undetermined` is not a soft `dead`.** Callers DELETE on `dead`.
 * Every way of failing to find out — budget spent, unreadable directory, enumeration threw —
 * resolves to `undetermined`, because deleting on "could not tell" is data loss and the fail-safe
 * direction is not symmetric here (`rules/error-handling.md`).
 *
 * **The budget is shared across the whole sweep, not per project.** A bound that resets each
 * iteration is not a bound; that is precisely what produced the 64M figure.
 */

import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * The filesystem, as this module needs it. Every call is ONE operation against the budget, and any
 * of them may throw (EACCES) — a throw is a third outcome, never "absent".
 */
export interface FsSeam {
  /**
   * Does `path` exist? **Three-valued**: `undefined` means "could not determine", and it is NOT the
   * same answer as `false`.
   *
   * The third state is in the RETURN TYPE rather than in prose because that is the only place an
   * adapter author reliably reads it. The consumer's scar (B-020) is exactly this: its adapter
   * mapped every `statSync` failure to `false`, and since the verdict branches on that value, a cwd
   * that exists but cannot be stat-ed — EACCES on a non-traversable parent, ENOTDIR mid-path, EMFILE
   * under a wide sweep — was classified DEAD, which is a deletion. A signature of `=> boolean`
   * invites `try { return existsSync(p) } catch { return false }`, which reintroduces it silently.
   *
   * ENOENT is the only errno that means absence. Everything else is `undefined`. Throwing is also
   * accepted and treated as `undefined`, so an adapter that does neither still cannot cause a
   * deletion.
   */
  exists: (path: string) => boolean | undefined
  /** Entry names directly under `dir`. Used to find a transcript to read the recorded cwd from. */
  listEntries: (dir: string) => readonly string[]
  /** The first line of `file`. The transcript's first record carries the `cwd` it was written in. */
  firstLine: (file: string) => string
}

export type Liveness = 'alive' | 'dead' | 'undetermined'

export interface LivenessVerdict {
  readonly liveness: Liveness
  /** Why — carried on every verdict, so an operator reading a GC log is never left guessing. */
  readonly reason: string
}

export interface ClassifyProjectsOptions {
  /**
   * Where `projects/<encoded>/` lives, so the recorded-cwd read can find a transcript.
   * Use {@link projectsRoot} rather than joining the segment by hand — that segment had three
   * owners once, and a wrong one makes every project look empty rather than erroring.
   */
  projectsRoot: string
  /**
   * REAL ABSOLUTE PATHS that might be the project — not encoded directory names.
   *
   * The name is explicit because the previous one was not, and the ambiguity was a defect rather
   * than a documentation gap: the only consumer's `listProjects` returns ENCODED NAMES (it keeps
   * classification in a separate injected seam), so wiring the two together fed encoded names to a
   * function expecting paths. Measured 2026-08-16: 6 of 6 live projects classified `dead`, on the
   * path where the caller DELETES.
   *
   * PRODUCT policy: which directories are even candidates (workspaces, ignore rules, mounted
   * volumes) is not this module's to guess. It is also only a HEURISTIC — see the fall-through in
   * `searchPool`, which is why exhausting it can never prove absence.
   */
  candidatePaths: () => readonly string[]
  /** Total filesystem operations allowed for the ENTIRE sweep. */
  budget: number
  fs: FsSeam
  /** How many transcripts to read per project before giving up on the recorded cwd. Default 3. */
  transcriptSamples?: number
}

/** Matches the consumer's measured default: 91 of 120 sampled projects resolved within 3. */
const DEFAULT_TRANSCRIPT_SAMPLES = 3

/**
 * What reading the recorded cwd produced. Three outcomes, discriminated
 * (`rules/type-safety.md` — discriminated unions for error handling), because they lead to three
 * different verdicts and collapsing any two loses the distinction the module exists to keep:
 * `found` can prove either liveness or death, `absent` proves nothing, and `unreadable` is a fact
 * about the directory rather than about the project.
 */
type RecordedCwd =
  | { readonly kind: 'found'; readonly cwds: readonly string[] }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly error: string }

/** The encoding this module is the inverse-by-search of. Kept local: it is one line and it is ours. */
function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * REMOVED 2026-08-16 — `likelyPath`, which turned every `-` back into `/` and was documented as
 * "correct for the overwhelming majority of real paths". It is correct for no path containing a
 * hyphen, which is most of them:
 *
 *     encode('/home/op/Projetos/theo/theokit-framework')
 *       → '-home-op-Projetos-theo-theokit-framework'
 *     likelyPath(that)
 *       → '/home/op/Projetos/theo/theokit/framework'   ← not the input
 *
 * The encoding is lossy on purpose (`/a/b` and `/a-b` collide), so no string transform can invert
 * it. What replaces it is not a better guess but the actual answer: the transcript records the cwd
 * it was written in, and reading it costs one line of one file.
 */

/**
 * Raised when `budget` cannot bound anything. Refusing beats clamping, for the same reason
 * `transcript-gc.ts` states as its invariant 1: an operator who asked for a policy must not be
 * silently given a different one.
 */
export class LivenessBudgetError extends TheokitAgentError {
  constructor(budget: number) {
    super(
      `refusing to classify projects with budget ${String(budget)}: it must be a non-negative integer. ` +
        `The bound is spent with \`remaining -= 1\`, and on a non-finite value that subtraction never ` +
        `reaches zero — so every \`remaining <= 0\` guard becomes a no-op and the sweep is unbounded, ` +
        `which is the ~64M-syscall run this module exists to prevent. Pass a real ceiling (at the ` +
        `measured 2.54 ops/project, a tree of N projects wants >= 3N); \`0\` is valid and means ` +
        `"spend nothing", yielding \`undetermined\` for every project.`,
    )
  }
}

/**
 * The bound has to actually bound. Validated at the boundary rather than defended at each use
 * (`rules/error-handling.md`): past this line `remaining` is trusted, and there is exactly one place
 * to read what "usable" means.
 */
function assertUsableBudget(budget: number): void {
  if (!Number.isInteger(budget) || budget < 0) throw new LivenessBudgetError(budget)
}

/** One budgeted existence probe. `error` covers both a throw and the seam's `undefined`. */
type Probe = (path: string) => { found: boolean } | { error: string }

/**
 * The verdict for a directory whose transcripts named one or more cwds.
 *
 * EVERY member of the collision class is probed and the strongest evidence wins:
 *
 * | observed | verdict | why |
 * |---|---|---|
 * | any one exists | `alive` | the class has a live member, so the directory is in use |
 * | any one unprobeable | `undetermined` | absence was not established |
 * | all definitively gone | `dead` | the only thing that proves absence |
 *
 * First-match-wins is what this replaces, and it was not a shortcut but a defect: the encoding is
 * many-to-one, so `encodeProjectDir(cwd) === name` narrows to a CLASS, never to a path. Letting one
 * member decide meant a single record could condemn the rest — and transcripts are user-writable, so
 * that record can be planted. The consumer's oracle has the same flaw
 * (`TheoCode/.../liveness-oracle.ts:168-181`); the framework can fix it because the framework owns
 * the encoding that creates the collision.
 */
function verdictFromRecordedCwds(
  cwds: readonly string[],
  probe: Probe,
  budgetLeft: () => boolean,
): LivenessVerdict {
  let unprobeable: string | undefined
  for (const cwd of cwds) {
    if (!budgetLeft()) {
      unprobeable ??= 'search budget exhausted'
      break
    }
    const at = probe(cwd)
    if ('error' in at) {
      unprobeable ??= `could not stat ${cwd}: ${at.error}`
      continue
    }
    if (at.found) return { liveness: 'alive', reason: `recorded cwd ${cwd} exists` }
  }
  return unprobeable !== undefined
    ? { liveness: 'undetermined', reason: unprobeable }
    : { liveness: 'dead', reason: `every recorded cwd is gone (${cwds.join(', ')})` }
}

/**
 * Classify each encoded project directory. Every input appears in the output: a missing key would
 * read to a caller as "not dead", which is safe only by accident.
 */
export function classifyProjects(
  encoded: readonly string[],
  opts: ClassifyProjectsOptions,
): Map<string, LivenessVerdict> {
  assertUsableBudget(opts.budget)

  const out = new Map<string, LivenessVerdict>()
  let remaining = opts.budget

  /**
   * One budgeted probe. A THROW is a third outcome, distinct from "absent" — and the error text is
   * carried out rather than discarded: an operator reading "unreadable" in a GC log needs to know it
   * was EACCES on a specific path, not that something went wrong somewhere.
   */
  const probe = (path: string): { found: boolean } | { error: string } => {
    remaining -= 1
    try {
      const answer = opts.fs.exists(path)
      // `undefined` is the seam's "could not determine" and must NOT collapse into `false`; that
      // collapse is the consumer's B-020 scar and it ends in a deletion. Carried out as an error so
      // every caller below already handles it — there is no path that treats it as absence.
      return answer === undefined
        ? { error: `could not determine whether ${path} exists` }
        : { found: answer }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  // Enumeration is resolved ONCE for the sweep: it is product policy, it may be expensive, and a
  // list that changed between projects would make the verdicts mutually inconsistent.
  /**
   * The ANSWER, not a guess: a transcript's first record carries the `cwd` it was written in.
   *
   * Absorbed from the consumer, whose docstring measured this path resolving 91 of 120 sampled
   * projects — each one without spending a single unit of search budget. The plan's pseudo-code
   * specified only the fallback, which is how a module that exists to avoid a 64M-syscall sweep
   * shipped able to do nothing else.
   *
   * The recorded cwd MUST encode back to the directory it was found in. Without that check a stray
   * or copied transcript would speak for a project it never belonged to.
   */
  const recordedCwd = (name: string): RecordedCwd => {
    const dir = `${opts.projectsRoot}/${name}`
    let entries: readonly string[]
    remaining -= 1
    try {
      entries = opts.fs.listEntries(dir)
    } catch (error) {
      return {
        kind: 'unreadable',
        error: error instanceof Error ? error.message : String(error),
      }
    }
    const samples = opts.transcriptSamples ?? DEFAULT_TRANSCRIPT_SAMPLES
    const cwds: string[] = []
    for (const file of entries.filter((f) => f.endsWith('.jsonl')).slice(0, samples)) {
      if (remaining <= 0) break
      remaining -= 1
      let record: unknown
      try {
        record = JSON.parse(opts.fs.firstLine(`${dir}/${file}`))
      } catch {
        // A truncated or half-written first line is not an error about the PROJECT. Try the next
        // transcript; running out of samples just means this path did not answer.
        continue
      }
      const cwd = (record as { cwd?: unknown } | null)?.cwd
      if (typeof cwd !== 'string' || cwd.length === 0) continue
      // EVERY match is collected, never the first. `encodeProjectDir(cwd) === name` narrows to a
      // COLLISION CLASS, not to a path — `/a/b` and `/a-b` encode identically and therefore share
      // one project directory. Returning on the first match lets one member of the class decide the
      // verdict for all of them, and since transcripts are user-writable that member can be planted.
      if (encodeProjectDir(cwd) === name && !cwds.includes(cwd)) cwds.push(cwd)
    }
    return cwds.length > 0 ? { kind: 'found', cwds } : { kind: 'absent' }
  }

  let candidates: readonly string[] | undefined
  let enumerationError: string | undefined
  const enumerate = (): readonly string[] => {
    if (candidates === undefined && enumerationError === undefined) {
      try {
        candidates = opts.candidatePaths()
      } catch (error) {
        // Every project becomes `undetermined`. Reporting `dead` here would delete every transcript
        // on the machine because one directory listing failed.
        enumerationError = `could not enumerate candidate projects: ${String(error)}`
        candidates = []
      }
    }
    return candidates ?? []
  }

  /**
   * Search the candidate pool for one whose encoding is `name`. Split out so the sweep above reads
   * as the budget-and-order story it is, and this reads as the search it is.
   *
   * Candidates are de-duplicated: a list that repeats — which is how a symlink cycle in the
   * PRODUCT's enumeration reaches us (EC-9) — then costs its distinct entries rather than its
   * length. The budget bounds it either way; this stops the bound being spent re-deriving the same
   * answer.
   */
  const searchPool = (name: string, pool: readonly string[]): LivenessVerdict => {
    const seen = new Set<string>()
    for (const candidate of pool) {
      if (remaining <= 0) return { liveness: 'undetermined', reason: 'search budget exhausted' }
      if (seen.has(candidate)) continue
      seen.add(candidate)
      if (encodeProjectDir(candidate) !== name) continue

      const hit = probe(candidate)
      if ('error' in hit) {
        return { liveness: 'undetermined', reason: `could not stat ${candidate}: ${hit.error}` }
      }
      if (hit.found) {
        return { liveness: 'alive', reason: `found by search at ${candidate}` }
      }
    }
    // NEVER `dead`. The pool is a caller-supplied HEURISTIC, so exhausting it establishes that the
    // pool did not contain the project — not that the project is gone. The only positive evidence
    // of absence this module accepts is a recorded cwd that is not on disk, and that is decided in
    // the sweep below, not here.
    //
    // What was here before returned `dead` on this line, including for an EMPTY pool, and its
    // reason said "no candidate project encodes to this name" even when one had matched and merely
    // failed to stat. Callers DELETE on `dead` (`rules/error-handling.md` — the fail-safe direction
    // is not symmetric).
    return remaining <= 0
      ? { liveness: 'undetermined', reason: 'search budget exhausted' }
      : {
          liveness: 'undetermined',
          reason: 'no candidate path matched, and the candidate pool is not exhaustive',
        }
  }

  for (const name of encoded) {
    if (remaining <= 0) {
      out.set(name, { liveness: 'undetermined', reason: 'search budget exhausted' })
      continue
    }

    // 1. The recorded cwd — the only path that can produce EITHER definitive verdict.
    const recorded = recordedCwd(name)
    if (recorded.kind === 'unreadable') {
      // Unreadable is not absent, and the real message travels with the verdict.
      out.set(name, {
        liveness: 'undetermined',
        reason: `could not read ${opts.projectsRoot}/${name}: ${recorded.error}`,
      })
      continue
    }
    if (recorded.kind === 'found') {
      out.set(
        name,
        verdictFromRecordedCwds(recorded.cwds, probe, () => remaining > 0),
      )
      continue
    }

    const pool = enumerate()
    out.set(
      name,
      enumerationError === undefined
        ? searchPool(name, pool)
        : { liveness: 'undetermined', reason: enumerationError },
    )
  }

  return out
}
