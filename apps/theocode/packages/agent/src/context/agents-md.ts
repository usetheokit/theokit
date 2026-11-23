import { loadInstructionWalk } from '@theokit/agents/config'
import { basename, dirname, resolve } from 'node:path'

type WarnFn = (message: string) => void

const MAX_CHARS = 64_000
const SEPARATOR = '\n\n--- project-doc ---\n\n'
/**
 * The upward walk is the framework's: `loadInstructionWalk` in `@theokit/agents/config` climbs from
 * the working directory to the git root, strips frontmatter, expands `@file.md` imports inside a
 * containment root and keeps the public and `.local` chains independent. This file no longer
 * walks a directory.
 *
 * What stays ours, because the framework's answer differs:
 *  - ORDER. The framework returns the whole public chain, then the whole local chain. This product
 *    interleaves them per directory, root-most first, base before local, so a private note sits
 *    next to the file it annotates.
 *  - BUDGET. The framework drops whole files at its ceiling; it is asked for none here, and the
 *    joined text is cut from the START at `MAX_CHARS` (root-most content goes first), as before.
 *    The aggregate policy of `composeInstructions` below is likewise ours.
 *  - NAMES. `CLAUDE.md` is not in the framework default, so both lists are passed.
 *
 * The containment root for imports is the framework's: the shallowest directory holding a file,
 * which is at most the git root.
 */
/**
 * The instruction file, in order of precedence, FIRST-WINS per directory level.
 *
 * `THEO.md` is this product's own name; `AGENTS.md` is the cross-tool convention; `CLAUDE.md` is
 * read so a repository written for Claude Code steers this agent with no migration.
 *
 * FIRST-WINS: a directory contributes exactly ONE base file. A repository that grows a `THEO.md`
 * therefore stops reading its `AGENTS.md` — one file steers, and which one is unambiguous.
 */
export const BASE_NAMES = ['THEO.md', 'AGENTS.md', 'CLAUDE.md'] as const

/**
 * The private companion, running its OWN chain rather than following the winner above, so adding a
 * `THEO.md` never orphans an existing `AGENTS.local.md`.
 */
const LOCAL_NAMES = ['THEO.local.md', 'AGENTS.local.md', 'CLAUDE.local.md'] as const

interface LoadedFile {
  readonly path: string
  readonly content: string
}

const quiet: WarnFn = () => undefined

/** Files in the order the prompt carries them: root-most directory first, base before local. */
async function loadChain(cwd: string, warn: WarnFn): Promise<LoadedFile[]> {
  const root = resolve(cwd)
  const tree = await loadInstructionWalk({
    cwd: root,
    alternatives: BASE_NAMES,
    local: LOCAL_NAMES,
    maxChars: Number.MAX_SAFE_INTEGER,
    onWarn: warn,
  })
  const isLocal = (p: string): boolean => (LOCAL_NAMES as readonly string[]).includes(basename(p))
  return tree.blocks
    .map((b) => ({ path: resolve(root, b.path), content: b.content.trim() }))
    .map((f, i) => ({ f, i }))
    .sort(
      (x, y) =>
        dirname(x.f.path).length - dirname(y.f.path).length ||
        Number(isLocal(x.f.path)) - Number(isLocal(y.f.path)) ||
        x.i - y.i,
    )
    .map(({ f }) => f)
}

/** The paths the walk reads, in the order `loadAgentsMd` composes them. */
export async function agentsMdChain(cwd: string): Promise<readonly string[]> {
  return (await loadChain(cwd, quiet)).map((f) => f.path)
}

export async function loadAgentsMd(
  cwd: string,
  warn: WarnFn = (m) => process.stderr.write(`${m}\n`),
): Promise<string> {
  const joined = (await loadChain(cwd, warn))
    .map((f) => f.content)
    .filter(Boolean)
    .join(SEPARATOR)
  if (joined.length > MAX_CHARS) {
    warn(
      `[agents-md] instruction chain truncated to ${MAX_CHARS} chars (was ${joined.length}) — root-most content dropped first`,
    )
    return joined.slice(-MAX_CHARS)
  }
  return joined
}

interface AggregateBudget {
  maxChars: number
  warn: (m: string) => void
}

/**
 * One cut the aggregate ceiling made, in RENDERED chars.
 *
 * `source` is what makes this usable downstream: the ceiling can cut the surface document or
 * leave the base oversized, and neither is a rule. A report that omitted the source made the
 * `/status` RULES row claim truncation over a block nothing had touched (B-173).
 */
export interface InstructionCut {
  readonly source: 'rules' | 'agentsMd' | 'surface'
  readonly from: number
  readonly to: number
}

/**
 * The composed persona, and what fitting it cost.
 *
 * The name and the shape follow `@theokit/agents`, which publishes a `ComposedInstructions`
 * for the same job. Its trimming semantics differ from ours and are deliberately not adopted
 * here; the vocabulary for REPORTING a cut was already designed, and a third one would be the
 * reinvention Rule 9 is about.
 */
export interface ComposedInstructions {
  readonly text: string
  /** Empty when the composition fit. Never a boolean: the surface renders a share, not a yes. */
  readonly cuts: readonly InstructionCut[]
}

export const MAX_AGGREGATE = 96_000

const RULE_SEPARATOR = '\n\n---\n\n'

function trimBlocksFromStart(text: string, budget: number): string {
  if (text.length <= budget) return text
  const blocks = text.split(RULE_SEPARATOR)
  while (blocks.length > 0 && blocks.join(RULE_SEPARATOR).length > budget) blocks.shift()
  return blocks.join(RULE_SEPARATOR)
}

/**
 * The project document as the four named sources it is made of, in the order they are rendered.
 * Each is trimmed by its own policy, so a `---` horizontal rule inside an AGENTS.md is never
 * mistaken for the boundary of a rules block.
 */
export interface ProjectDocParts {
  readonly userAgentsMd: string
  readonly userRules: string
  readonly projectAgentsMd: string
  readonly projectRules: string
}

export type ProjectDoc = string | ProjectDocParts

type PartKey = keyof ProjectDocParts
const PART_ORDER: readonly PartKey[] = [
  'userAgentsMd',
  'userRules',
  'projectAgentsMd',
  'projectRules',
]
/** Rules go first, the project's before the user's; AGENTS.md follows, the user's before the project's. */
const RULES_TRIM_ORDER: readonly PartKey[] = ['projectRules', 'userRules']
const AGENTS_MD_TRIM_ORDER: readonly PartKey[] = ['userAgentsMd', 'projectAgentsMd']

function toParts(doc: ProjectDoc): ProjectDocParts {
  return typeof doc === 'string'
    ? { userAgentsMd: '', userRules: '', projectAgentsMd: doc, projectRules: '' }
    : doc
}

function renderParts(parts: ProjectDocParts): string {
  return PART_ORDER.map((k) => parts[k])
    .filter((s) => s.length > 0)
    .join('\n\n')
}

export function composeInstructions(
  base: string,
  projectDoc: ProjectDoc,
  surfaceDoc = '',
  opts?: AggregateBudget,
  /** Basenames the project document was read from, so the header can name them honestly. */
  sources?: readonly string[],
): ComposedInstructions {
  if (opts === undefined) {
    return { text: build(base, renderParts(toParts(projectDoc)), surfaceDoc, sources), cuts: [] }
  }
  if (opts.maxChars <= 0) {
    throw new RangeError(`maxChars=${String(opts.maxChars)} — the aggregate budget must be > 0`)
  }
  return withinBudget(base, toParts(projectDoc), surfaceDoc, opts, sources)
}

function withinBudget(
  base: string,
  projectDoc: ProjectDocParts,
  surfaceDoc: string,
  opts: AggregateBudget,
  sources?: readonly string[],
): ComposedInstructions {
  const parts: Record<PartKey, string> = { ...projectDoc }
  let surface = surfaceDoc
  const cuts: InstructionCut[] = []
  const total = (): number => build(base, renderParts(parts), surface, sources).length

  const trimSource = (
    source: 'rules' | 'agentsMd',
    keys: readonly PartKey[],
    trim: (text: string, budget: number) => string,
  ): void => {
    let from = 0
    let to = 0
    for (const key of keys) {
      const before = parts[key]
      if (before.length === 0) continue
      const over = Math.max(0, total() - opts.maxChars)
      const after = over === 0 ? before : trim(before, Math.max(0, before.length - over))
      from += before.length
      to += after.length
      parts[key] = after
    }
    if (to === from) return
    cuts.push({ source, from, to })
    opts.warn(
      `[instructions] source '${source}' truncated from ${String(from)} to ` +
        `${String(to)} chars (aggregate budget ${String(opts.maxChars)})`,
    )
  }

  if (total() > opts.maxChars) trimSource('rules', RULES_TRIM_ORDER, trimBlocksFromStart)
  if (total() > opts.maxChars) {
    trimSource('agentsMd', AGENTS_MD_TRIM_ORDER, (t, budget) =>
      budget === 0 ? '' : t.slice(-budget),
    )
  }
  if (total() > opts.maxChars && surface.length > 0) {
    const before = surface.length
    surface = surface.slice(-Math.max(0, before - (total() - opts.maxChars)))
    // Guarded like the two branches above it, and for a reason `cuts` made newly load-bearing:
    // when the overflow exceeds the whole surface, `slice(-0)` returns the WHOLE string, so an
    // unguarded push records a zero-width cut. Harmless while this was only a warning; real now
    // that a consumer reads it — the same phantom shape as a report claiming a cut nobody made.
    if (surface.length !== before) {
      cuts.push({ source: 'surface', from: before, to: surface.length })
    }
    opts.warn(
      `[instructions] source 'appendInstructions' truncated from ${String(before)} to ` +
        `${String(surface.length)} chars (aggregate budget ${String(opts.maxChars)})`,
    )
  }
  if (total() > opts.maxChars) {
    opts.warn(
      `[instructions] BASE_INSTRUCTIONS alone exceeds the aggregate budget ` +
        `(${String(total())} > ${String(opts.maxChars)}) — nothing was truncated`,
    )
  }
  return { text: build(base, renderParts(parts), surface, sources), cuts }
}

/**
 * How the project-instruction header names its own source.
 *
 * It used to say "from AGENTS.md" unconditionally, while `BASE_NAMES` accepts THEO.md, AGENTS.md
 * and CLAUDE.md, and `LOCAL_NAMES` adds more. A project carrying only `CLAUDE.md` was told its
 * instructions came from a file it does not have — measured 2026-09-15, when a canary appended to
 * `CLAUDE.md` was reported back as coming from `AGENTS.md`.
 *
 * With no sources the header names none. An unqualified header is weaker than a precise one and
 * far better than one pointing at a path the reader cannot open: a reader who opens the named file
 * and finds nothing learns that the attribution cannot be trusted, which costs more than it saves.
 */
function sourceClause(sources: readonly string[] | undefined): string {
  const named = (sources ?? []).filter((s) => s.trim().length > 0)
  return named.length > 0 ? `from ${named.join(', ')} — ` : ''
}

function build(
  base: string,
  projectDoc: string,
  surfaceDoc: string,
  sources?: readonly string[],
): string {
  const parts = [base]
  if (projectDoc.trim()) {
    parts.push(
      `## Project instructions (${sourceClause(sources)}follow these for THIS project)\n${projectDoc}`,
    )
  }
  if (surfaceDoc.trim()) {
    parts.push(`## Surface instructions (how THIS run is being driven)\n${surfaceDoc}`)
  }
  return parts.join('\n\n')
}
