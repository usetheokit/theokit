/* eslint-disable security/detect-non-literal-fs-filename --
 * Session lifecycle over the transcript root. Every path here is built from `transcriptRoot()` plus
 * a session id or an `encodeProjectDir` hash — never from HTTP input. The variable filename IS the
 * feature: a module whose job is listing and deleting sessions cannot address them by literal.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { encodeProjectDir, transcriptRoot } from '@theokit/sdk/persistence'

/**
 * M71 — the reverse index `encodeProjectDir` never had.
 *
 * ## The asymmetry this fixes
 *
 * `encodeProjectDir(cwd)` is exported as a ONE-WAY street: it hashes a working directory into the
 * name of a folder under the transcript root, and nothing reads it back. So the question "does the
 * project behind `projects/<hash>/` still exist?" — which any retention or GC pass has to answer
 * before deleting anything — had no answer at all.
 *
 * The measured consequence in the consumer was 188 LOC of filesystem DFS: walk the disk, hash every
 * candidate directory, and see which one matches. That is a search standing in for a lookup, and it
 * gets slower exactly as the machine gets more projects.
 *
 * ## Why a sidecar, and why it is written HERE rather than at creation
 *
 * The milestone offered two options: a sidecar written when the transcript is created, or a
 * `classifyProject(name)` oracle. The first is not ours to do — transcript creation is SDK-owned,
 * and this module deliberately writes no transcript (the ADR line that keeps absorbing lifecycle
 * from becoming ownership of the store).
 *
 * So the sidecar is written the first time THIS layer is told a cwd, and read by name afterwards. It
 * is honest about its own limit: a project directory created before this module ever saw it has no
 * sidecar, and {@link resolveProjectDir} says `undefined` rather than guessing. `undefined` means
 * "not known here", never "does not exist" — a caller that deleted on the second reading would
 * delete live projects.
 */

/** Name of the sidecar inside `projects/<hash>/`. Not a transcript: a single line of plain text. */
const CWD_SIDECAR = 'cwd'

/** Absolute path of the project directory for `cwd`, under the transcript root. */
/**
 * Where every project's transcripts live under `root`.
 *
 * The `projects` segment was written in three places — twice in this file, and once in the closest
 * consumer, which restated it as `join(transcriptRoot(), 'projects')` to enumerate every project for
 * a GC sweep. Three owners of one layout fact.
 *
 * The failure mode is what makes it worth a function rather than a comment: the consumer guards its
 * enumeration with `existsSync(root) ? readdir(root) : []`, so a segment that no longer matches does
 * not throw — it returns an empty list. The sweep then finds nothing, deletes nothing, and reports
 * success. A wrong path that throws is a bug report; a wrong path that returns nothing is a
 * collector that quietly stopped collecting.
 */
export function projectsRoot(root: string = transcriptRoot()): string {
  return join(root, 'projects')
}

export function projectDirFor(cwd: string, root: string = transcriptRoot()): string {
  return join(projectsRoot(root), encodeProjectDir(cwd))
}

/**
 * Record that `cwd` is the project behind its encoded directory.
 *
 * Idempotent and best-effort by design: this is an index, and a machine that cannot write it should
 * still be able to run an agent. A throw here would turn a missing optimisation into a failed run.
 */
export function recordProjectDir(cwd: string, root: string = transcriptRoot()): void {
  const sidecar = join(projectDirFor(cwd, root), CWD_SIDECAR)
  try {
    mkdirSync(dirname(sidecar), { recursive: true })
    writeFileSync(sidecar, `${cwd}\n`, 'utf8')
  } catch {
    // Intentionally swallowed — see the docblock. The read side treats a missing sidecar as
    // "not known here", which is the same state as never having written it.
  }
}

/**
 * The cwd behind an encoded project directory name, or `undefined` when this layer never saw it.
 *
 * `undefined` is NOT "the project is gone". It is "no sidecar here", which a project created before
 * this index existed also produces. A caller that treated the two as the same would delete live
 * projects — which is precisely why the distinction is stated rather than left to the reader.
 */
export function resolveProjectDir(
  encodedName: string,
  root: string = transcriptRoot(),
): string | undefined {
  try {
    const raw = readFileSync(join(projectsRoot(root), encodedName, CWD_SIDECAR), 'utf8')
    const cwd = raw.trim()
    return cwd.length > 0 ? cwd : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether `encodedName` is the encoding of `cwd`.
 *
 * The verification that makes the index trustworthy rather than merely convenient: a sidecar can be
 * stale (the directory was renamed) and re-encoding is the cheap way to notice. It is also the whole
 * of the `classifyProject` oracle the milestone offered as the alternative — kept as a companion to
 * the index rather than a replacement, because it can only confirm a cwd the caller already has.
 */
export function projectDirMatches(encodedName: string, cwd: string): boolean {
  return encodeProjectDir(cwd) === encodedName
}
