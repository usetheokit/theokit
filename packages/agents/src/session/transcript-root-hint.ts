/**
 * Why an empty session list can be empty: the transcript root moved.
 *
 * ## Why this belongs to the framework
 *
 * The consumer wrote this and the ownership tell is in the code: it reads `THEOKIT_HOME` — this
 * package's environment variable — and lists `projectsRoot(previous)` — this package's directory
 * layout, whose owner became `projectsRoot()` in `b30fe9f1`. A product should not have to explain a
 * layout it neither controls nor changed, and every product that ever moves its root needs the same
 * sentence written against the same internals.
 *
 * ## Why it is a hint and never a repair
 *
 * Moving someone's transcripts is an operator decision. A function that relocated data during an
 * empty-state read would be a far bigger surprise than the empty state it explains, and it runs on
 * the path where the user already believes something is wrong.
 */
import { readdirSync } from 'node:fs'

import { projectsRoot } from './project-index.js'

/**
 * A sentence explaining an empty session list, or `undefined` when there is nothing true to say.
 *
 * Returns `undefined` in every case where the hint would be noise or a guess: sessions were found,
 * the root was not overridden, the override equals the previous root, the previous root cannot be
 * read, or it holds no projects. A hint that fires spuriously is worse than none — people stop
 * reading the ones that matter.
 *
 * @param found - how many sessions the caller's own listing returned.
 * @param previousRoot - the root to look in, typically the default before the override.
 * @param env - injected so a test needs no global mutation; defaults to the real environment.
 */
export function transcriptRootHint(
  found: number,
  previousRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (found > 0) return undefined

  const current = env.THEOKIT_HOME?.trim()
  if (current === undefined || current.length === 0) return undefined
  if (current === previousRoot) return undefined

  let projects: readonly string[]
  try {
    // The path is this package's own transcript layout, built from a root the caller already owns
    // and reads. The call is a directory LISTING on the empty-state path, and refusing a dynamic
    // root here would mean refusing to explain the very move that produced the empty state.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- own layout, caller's root, listing only
    projects = readdirSync(projectsRoot(previousRoot))
  } catch {
    return undefined
  }
  if (projects.length === 0) return undefined

  return (
    `No sessions under ${current} (THEOKIT_HOME). ` +
    `${String(projects.length)} project(s) with sessions remain under the previous root ` +
    `${previousRoot} — unset THEOKIT_HOME to see them again, or move the contents across.`
  )
}
