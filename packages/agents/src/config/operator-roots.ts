import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * B-024 — read the operator's roots when `user: true`, or say why not.
 *
 * `SettingSourcesSelection.user` was forwarded and consulted by nothing: a flag a consumer could set
 * that changed no behaviour and produced no complaint. That is the accepted-and-ignored failure
 * `rules/foreign-config-surfaces.md` removes for `.claude/` file surfaces — *a surface is read, or it
 * is refused with a reason; never accepted and ignored*.
 *
 * ## Two roots, one grant, one label
 *
 * `~/.theokit/` is ours: `user: true` is the whole permission. `~/.claude/` belongs to another
 * product under a shared home, and it passes the SAME `claude-code` dialect grant that gates the
 * project's `.claude/` surfaces — never a looser one. `user` says WHICH MACHINE; the dialect says
 * WHOSE FORMAT, and collapsing them would admit a foreign inventory on a flag that never mentioned
 * it.
 *
 * Every definition carries the root it came from, because an operator has to be able to tell one
 * they wrote for this product from one they wrote for another — at the point of use, not by
 * remembering which directory they put it in.
 */

/** Which root a definition was loaded from. */
export type OperatorOrigin = 'theokit' | 'claude-code'

/** A definition found under an operator root. */
export interface OperatorDefinition {
  readonly name: string
  readonly path: string
  readonly origin: OperatorOrigin
}

/** A root that exists and was NOT read, with the grant that would admit it. */
export interface WithheldRoot {
  readonly root: string
  readonly reason: string
}

/** A file under a read root that could not be taken as a definition. */
export interface SkippedDefinition {
  readonly path: string
  readonly reason: string
}

export interface OperatorRootsResult {
  readonly definitions: readonly OperatorDefinition[]
  /** Roots actually walked. Empty when `user` is absent — the proof of NFR-002, not a claim. */
  readonly rootsRead: readonly string[]
  /** Roots present and withheld, each NAMED. A count would tell an operator they lost something and not what. */
  readonly withheld: readonly WithheldRoot[]
  readonly skipped: readonly SkippedDefinition[]
}

export interface OperatorRootsOptions {
  /** `SettingSourcesSelection.user`. When false or absent, nothing is read at all. */
  readonly user?: boolean
  /** The dialects the consumer granted, e.g. `['claude-code']`. */
  readonly grants?: readonly string[]
  /** Overridable for tests; defaults to the real home. */
  readonly homeDir?: string
}

/** An operator root exists and cannot be read. Refused loudly rather than reported as empty. */
export class OperatorRootUnreadableError extends TheokitAgentError {
  override readonly name = 'OperatorRootUnreadableError'

  constructor(root: string, cause: unknown) {
    super(
      `operator root ${root} exists and could not be read: ${cause instanceof Error ? cause.message : String(cause)}. ` +
        `Reporting it as empty would be indistinguishable from an operator who configured nothing.`,
      { code: 'OPERATOR_ROOT_UNREADABLE', cause },
    )
  }
}

/** `~/.claude/` is another product's inventory; the same grant that admits its project surfaces admits this. */
const FOREIGN_DIALECT = 'claude-code'

const ROOTS: readonly {
  readonly dir: string
  readonly origin: OperatorOrigin
  readonly dialect?: string
}[] = [
  { dir: '.theokit', origin: 'theokit' },
  { dir: '.claude', origin: FOREIGN_DIALECT, dialect: FOREIGN_DIALECT },
]

/**
 * Why the non-literal `fs` reads below are safe, stated rather than suppressed.
 *
 * Every path is `join(base, <literal>, <literal>)` where `base` is the process owner's own home —
 * `homedir()`, or a caller-supplied directory in tests. The directory segments are the two literals
 * in `ROOTS` and the two in the `kind` tuple; none comes from a definition's content, from a network
 * response, or from anything a third party writes. A definition's FILENAME is used only after
 * `readdirSync` returned it from inside the root, so it cannot escape upward.
 *
 * The one input a consumer controls is `homeDir`, and a consumer who passes a directory is choosing
 * which of their own directories to read — the same authority they already have over `cwd`.
 */
function exists(p: string): boolean {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `p` is join(home, <literal>, <literal>); see the docblock above
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function readDefinitions(
  root: string,
  origin: OperatorOrigin,
  skipped: SkippedDefinition[],
): OperatorDefinition[] {
  let entries: string[]
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `root` is the operator's own directory, composed from literals
    entries = readdirSync(root)
  } catch (cause) {
    throw new OperatorRootUnreadableError(root, cause)
  }
  const out: OperatorDefinition[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    const path = join(root, entry)
    let body: string
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- `path` comes from readdirSync INSIDE `root`, so it cannot escape upward
      body = readFileSync(path, 'utf8')
    } catch (cause) {
      throw new OperatorRootUnreadableError(path, cause)
    }
    // Reported rather than dropped: a definition silently skipped is the same silence this
    // module exists to remove, one directory down.
    if (!body.startsWith('---')) {
      skipped.push({ path, reason: 'no frontmatter — not a definition' })
      continue
    }
    out.push({ name: entry.slice(0, -3), path, origin })
  }
  return out
}

/**
 * Resolve the operator's definitions for this run.
 *
 * With `user` absent or false nothing is walked — `rootsRead` is empty, and that is what the test
 * asserts rather than the empty result, because a read-everything-then-filter implementation
 * produces the same result at the cost of a walk on every run.
 */
export function resolveOperatorRoots(options: OperatorRootsOptions): OperatorRootsResult {
  if (options.user !== true) {
    return { definitions: [], rootsRead: [], withheld: [], skipped: [] }
  }
  const base = options.homeDir ?? homedir()
  const grants = new Set(options.grants ?? [])
  const definitions: OperatorDefinition[] = []
  const rootsRead: string[] = []
  const withheld: WithheldRoot[] = []
  const skipped: SkippedDefinition[] = []

  for (const { dir, origin, dialect } of ROOTS) {
    for (const kind of ['skills', 'agents'] as const) {
      const root = join(base, dir, kind)
      if (!exists(root)) continue
      if (dialect !== undefined && !grants.has(dialect)) {
        withheld.push({
          root,
          reason: `not loaded — declare the '${dialect}' dialect in compatSources to receive it`,
        })
        continue
      }
      rootsRead.push(root)
      definitions.push(...readDefinitions(root, origin, skipped))
    }
  }
  return { definitions, rootsRead, withheld, skipped }
}
