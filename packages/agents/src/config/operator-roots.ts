import { readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import type { AgentDefinition, TrustPosture } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'
import { discoverSubagents } from '@theokit/sdk/subagents-loader'

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

/** An operator's own `AGENTS.md` or a Markdown file under their `rules/` directory. */
export interface OperatorInstruction {
  readonly kind: 'instructions' | 'rules'
  readonly name: string
  readonly path: string
  readonly origin: OperatorOrigin
}

export interface OperatorRootsResult {
  readonly definitions: readonly OperatorDefinition[]
  /** `AGENTS.md` at the operator root (kind `instructions`) and `rules/*.md` (kind `rules`), no frontmatter required. */
  readonly instructions: readonly OperatorInstruction[]
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

/** `rules/*.md`: rules need no frontmatter, so they are listed by name, sorted for a stable prompt. */
function readRules(root: string, origin: OperatorOrigin): OperatorInstruction[] {
  let entries: string[]
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `root` is the operator's own directory, composed from literals
    entries = readdirSync(root)
  } catch (cause) {
    throw new OperatorRootUnreadableError(root, cause)
  }
  return entries
    .filter((entry) => entry.endsWith('.md'))
    .sort((a, b) => a.localeCompare(b))
    .map((entry) => ({
      kind: 'rules' as const,
      name: entry.slice(0, -3),
      path: join(root, entry),
      origin,
    }))
}

/** The operator's own `AGENTS.md` at the root of an operator directory, under the same grant. */
function readOperatorAgentsMd(
  dir: string,
  origin: OperatorOrigin,
  dialect: string | undefined,
  grants: ReadonlySet<string>,
  instructions: OperatorInstruction[],
  rootsRead: string[],
  withheld: WithheldRoot[],
): void {
  const path = join(dir, 'AGENTS.md')
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- `path` is join(home, <literal>, 'AGENTS.md')
    if (!statSync(path).isFile()) return
  } catch {
    return
  }
  if (dialect !== undefined && !grants.has(dialect)) {
    withheld.push({
      root: path,
      reason: `not loaded — declare the '${dialect}' dialect in compatSources to receive it`,
    })
    return
  }
  rootsRead.push(path)
  instructions.push({ kind: 'instructions', name: 'AGENTS', path, origin })
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
    return { definitions: [], instructions: [], rootsRead: [], withheld: [], skipped: [] }
  }
  const base = options.homeDir ?? homedir()
  const grants = new Set(options.grants ?? [])
  const definitions: OperatorDefinition[] = []
  const instructions: OperatorInstruction[] = []
  const rootsRead: string[] = []
  const withheld: WithheldRoot[] = []
  const skipped: SkippedDefinition[] = []

  for (const { dir, origin, dialect } of ROOTS) {
    for (const kind of ['skills', 'agents', 'rules'] as const) {
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
      if (kind === 'rules') instructions.push(...readRules(root, origin))
      else definitions.push(...readDefinitions(root, origin, skipped))
    }
    readOperatorAgentsMd(
      join(base, dir),
      origin,
      dialect,
      grants,
      instructions,
      rootsRead,
      withheld,
    )
  }
  return { definitions, instructions, rootsRead, withheld, skipped }
}

/** A foreign dialect to read, as the SDK's subagent loader takes it: a name, or a name with the surfaces to import. */
export type SubagentCompatSource =
  | string
  | { readonly kind: string; readonly import?: readonly string[] }

/** Which root a merged subagent definition came from. */
export type SubagentRootOrigin = 'project' | 'operator'

/** A subagent definition and the root it was read from, so the caller can apply per-root settings after the merge. */
export type RootedAgentDefinition = AgentDefinition & { readonly origin: SubagentRootOrigin }

export interface DiscoverSubagentsAcrossRootsOptions {
  /** The project directory. */
  readonly cwd: string
  /** The operator's home; defaults to the real one. */
  readonly homeDir?: string
  /** The project root is read only when the posture allows `projectSettings`. `false` skips it. */
  readonly project: { readonly trustedBy: TrustPosture<'projectSettings'> } | false
  /** Foreign dialects admitted per root. Absent means `.theokit/` only. */
  readonly compatSources?: {
    readonly project?: readonly SubagentCompatSource[]
    readonly operator?: readonly SubagentCompatSource[]
  }
}

export interface DiscoverSubagentsAcrossRootsResult {
  /** Project wins a name clash. */
  readonly definitions: Record<string, RootedAgentDefinition>
  /**
   * Operator definitions a same-named project definition replaced. A caller that drops a project
   * definition (an invalid `memory:`, say) can fall back to the operator's instead of losing the name.
   */
  readonly shadowed: Record<string, RootedAgentDefinition>
  /** Agent roots present and not read, each named with why. */
  readonly withheld: readonly WithheldRoot[]
}

/**
 * The operator's `~/.theokit/agents/` merged with the project's `.theokit/agents/`.
 *
 * The operator's root is never trust-gated (it is the operator's own); the project's is. Both go
 * through the SDK's one parser. `~/.claude/agents/` is read only when `compatSources.operator`
 * names `claude-code`, and is otherwise reported in `withheld`.
 */
function withheldAgentRoots(
  home: string,
  cwd: string,
  operatorCompat: readonly SubagentCompatSource[],
  project: DiscoverSubagentsAcrossRootsOptions['project'],
  projectTrusted: boolean,
): WithheldRoot[] {
  const out: WithheldRoot[] = []
  const foreign = join(home, '.claude', 'agents')
  const granted = operatorCompat.some(
    (c) => (typeof c === 'string' ? c : c.kind) === FOREIGN_DIALECT,
  )
  if (!granted && exists(foreign)) {
    out.push({
      root: foreign,
      reason: `not loaded — declare the '${FOREIGN_DIALECT}' dialect in compatSources to receive it`,
    })
  }
  // When the project IS the home, the operator read of that directory already happened.
  const native = join(cwd, '.theokit', 'agents')
  if (!projectTrusted && resolve(cwd) !== resolve(home) && exists(native)) {
    out.push({
      root: native,
      reason:
        project === false
          ? 'not loaded — project roots were not requested'
          : 'not loaded — the project is not trusted',
    })
  }
  return out
}

export async function discoverSubagentsAcrossRoots(
  options: DiscoverSubagentsAcrossRootsOptions,
): Promise<DiscoverSubagentsAcrossRootsResult> {
  const home = options.homeDir ?? homedir()
  const operatorCompat = options.compatSources?.operator ?? []
  const projectCompat = options.compatSources?.project ?? []
  const projectTrusted =
    options.project !== false && options.project.trustedBy.allows.projectSettings

  const [operator, project] = await Promise.all([
    discoverSubagents(home, {
      settingSources: ['project'],
      ...(operatorCompat.length > 0 ? { compatSources: operatorCompat } : {}),
    }),
    projectTrusted
      ? discoverSubagents(options.cwd, {
          settingSources: ['project'],
          ...(projectCompat.length > 0 ? { compatSources: projectCompat } : {}),
        })
      : Promise.resolve({} as Record<string, AgentDefinition>),
  ])

  const definitions: Record<string, RootedAgentDefinition> = {}
  const shadowed: Record<string, RootedAgentDefinition> = {}
  for (const [name, def] of Object.entries(operator)) {
    definitions[name] = { ...def, origin: 'operator' }
  }
  for (const [name, def] of Object.entries(project)) {
    if (name in definitions) shadowed[name] = definitions[name] as RootedAgentDefinition
    definitions[name] = { ...def, origin: 'project' }
  }
  return {
    definitions,
    shadowed,
    withheld: withheldAgentRoots(
      home,
      options.cwd,
      operatorCompat,
      options.project,
      projectTrusted,
    ),
  }
}
