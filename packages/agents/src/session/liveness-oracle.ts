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
 * `listProjects` — which directories are even candidates is PRODUCT policy (workspaces, ignore
 * rules, mounted volumes). This module must not guess it.
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

/**
 * The filesystem, as this module needs it. Every call is ONE operation against the budget, and any
 * of them may throw (EACCES) — a throw is a third outcome, never "absent".
 */
export interface FsSeam {
  exists: (path: string) => boolean
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
  | { readonly kind: 'found'; readonly cwd: string }
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
 * Classify each encoded project directory. Every input appears in the output: a missing key would
 * read to a caller as "not dead", which is safe only by accident.
 */
export function classifyProjects(
  encoded: readonly string[],
  opts: ClassifyProjectsOptions,
): Map<string, LivenessVerdict> {
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
      return { found: opts.fs.exists(path) }
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
    for (const file of entries.filter((f) => f.endsWith('.jsonl')).slice(0, samples)) {
      if (remaining <= 0) return { kind: 'absent' }
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
      if (encodeProjectDir(cwd) === name) return { kind: 'found', cwd }
    }
    return { kind: 'absent' }
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
      const at = probe(recorded.cwd)
      if ('error' in at) {
        out.set(name, {
          liveness: 'undetermined',
          reason: `could not stat ${recorded.cwd}: ${at.error}`,
        })
        continue
      }
      out.set(
        name,
        at.found
          ? { liveness: 'alive', reason: `recorded cwd ${recorded.cwd} exists` }
          : // THE one thing that proves absence: the transcript says where it lived, and it is not
            // there. Every other branch in this function resolves to `undetermined`.
            { liveness: 'dead', reason: `recorded cwd ${recorded.cwd} is gone` },
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
