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

/** Whether a path exists. One call = one operation against the budget. May throw (EACCES). */
export interface FsSeam {
  exists: (path: string) => boolean
}

export type Liveness = 'alive' | 'dead' | 'undetermined'

export interface LivenessVerdict {
  readonly liveness: Liveness
  /** Why — carried on every verdict, so an operator reading a GC log is never left guessing. */
  readonly reason: string
}

export interface ClassifyProjectsOptions {
  /** The candidate directories. PRODUCT policy: this module must not decide what counts. */
  listProjects: () => readonly string[]
  /** Total filesystem operations allowed for the ENTIRE sweep. */
  budget: number
  fs: FsSeam
}

/** The encoding this module is the inverse-by-search of. Kept local: it is one line and it is ours. */
function encodeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

/**
 * The cheap guess: turn every `-` back into `/`. Correct for the overwhelming majority of real
 * paths, and when it is wrong the search below covers it — so it is a fast path, never an answer on
 * its own.
 */
function likelyPath(encoded: string): string {
  return encoded.replace(/-/g, '/')
}

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
  let candidates: readonly string[] | undefined
  let enumerationError: string | undefined
  const enumerate = (): readonly string[] => {
    if (candidates === undefined && enumerationError === undefined) {
      try {
        candidates = opts.listProjects()
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
    return remaining <= 0
      ? { liveness: 'undetermined', reason: 'search budget exhausted' }
      : { liveness: 'dead', reason: 'no candidate project encodes to this name, within budget' }
  }

  for (const name of encoded) {
    if (remaining <= 0) {
      out.set(name, { liveness: 'undetermined', reason: 'search budget exhausted' })
      continue
    }

    const direct = probe(likelyPath(name))
    if ('error' in direct) {
      // Unreadable is not absent, and the real message travels with the verdict.
      out.set(name, {
        liveness: 'undetermined',
        reason: `could not stat ${likelyPath(name)}: ${direct.error}`,
      })
      continue
    }
    if (direct.found) {
      out.set(name, { liveness: 'alive', reason: 'resolved directly from the encoded name' })
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
