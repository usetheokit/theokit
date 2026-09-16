import { expandInstructionImports } from '@theokit/agents/config'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

type WarnFn = (message: string) => void

const MAX_CHARS = 64_000
const SEPARATOR = '\n\n--- project-doc ---\n\n'
/**
 * B-042 / absorbed 2026-08-15 — the `@file.md` expansion now comes from the framework.
 *
 * ~75 lines lived here: the regex, the code-span masking, the `realpath` containment check and the
 * depth/cycle bounds. All four are `expandInstructionImports` in `@theokit/agents/config`, and this
 * copy is where the containment bug B-042 had to be found and fixed by hand.
 *
 * What did NOT move is the WALK. The framework's `loadInstructionTree` descends into subdirectories;
 * this product's convention is the opposite — climb from the working directory to the git root and
 * read the ancestor chain. Two different traversals, and swapping one for the other would change
 * which files load. So the walk below stays ours and the expansion becomes theirs, which is the
 * split that was always correct.
 */
/**
 * The instruction files the walk finds, grouped by the directory they came from.
 *
 * ONE traversal, used by both callers. `/status` has to answer "is an AGENTS.md steering this
 * agent?" — Codex answers it on its own status panel (`Agents.md: <none>`) and this product
 * answered it nowhere — and the only wrong way to answer it is a second walk that can disagree
 * with the one that actually loaded.
 */
/**
 * The instruction file, in order of precedence, FIRST-WINS per directory level.
 *
 * `THEO.md` is this product's own name; `AGENTS.md` is the cross-tool convention; `CLAUDE.md` is
 * read so a repository written for Claude Code steers this agent with no migration — which was the
 * finding: the list was literal, so an adopter arriving from there brought nothing and started by
 * re-writing instructions they already had.
 *
 * FIRST-WINS is a change of kind, not of degree. The previous list read BOTH files it knew about at
 * every level; now a directory contributes exactly ONE. A repository that grows a `THEO.md`
 * therefore stops reading its `AGENTS.md` — that is the point (one file steers, and which one is
 * unambiguous) and it is also the surprise, so a test pins it rather than leaving it to be found.
 */
export const BASE_NAMES = ['THEO.md', 'AGENTS.md', 'CLAUDE.md'] as const

/**
 * The private companion, running its OWN chain rather than following the winner above.
 *
 * If it followed, adding a `THEO.md` would silently orphan an existing `AGENTS.local.md` — a file
 * the operator wrote, disabled by a file they added for an unrelated reason. Two independent chains
 * cost one line and remove that trap.
 */
const LOCAL_NAMES = ['THEO.local.md', 'AGENTS.local.md', 'CLAUDE.local.md'] as const

function walkInstructionChain(cwd: string): {
  rootDir: string
  chain: { dir: string; files: string[] }[]
} {
  const chain: { dir: string; files: string[] }[] = []
  let dir = cwd
  for (;;) {
    const files = [BASE_NAMES, LOCAL_NAMES]
      .map((names) => names.map((f) => join(dir, f)).find((p) => existsSync(p)))
      .filter((p): p is string => p !== undefined)
    if (files.length > 0) chain.push({ dir, files })
    // The repository root bounds the import expansion below.
    if (existsSync(join(dir, '.git'))) return { rootDir: dir, chain }
    const parent = dirname(dir)
    if (parent === dir) {
      // B-042 — reaching the FILESYSTEM ROOT used to set `rootDir = '/'`, which makes
      // `insideRoot(anything, '/')` true: outside a git repository the confinement did not merely
      // stop working, it permitted reading any file on the machine into the system prompt. With no
      // repository to bound it, the project IS the working directory.
      return { rootDir: cwd, chain }
    }
    dir = parent
  }
}

/** The paths the walk would read, root-most first — the order `loadAgentsMd` composes them in. */
export function agentsMdChain(cwd: string): readonly string[] {
  return walkInstructionChain(cwd)
    .chain.flatMap((l) => l.files)
    .reverse()
}

export function loadAgentsMd(
  cwd: string,
  warn: WarnFn = (m) => process.stderr.write(`${m}\n`),
): string {
  const { rootDir, chain } = walkInstructionChain(cwd)
  const chainPaths = new Set(chain.flatMap((l) => l.files))

  const found: string[] = []
  for (const level of chain) {
    const visited = new Set(chainPaths)
    const parts = level.files.map((p) =>
      expandInstructionImports({
        text: readFileSync(p, 'utf8').trim(),
        filePath: p,
        rootDir,
        onWarn: warn,
        // Markers stay: they are visible in the model's prompt, and presentation is this product's.
        wrap: (name, content) => `\n--- import: ${name} ---\n${content}\n--- end import ---\n`,
        // Everything the chain already read — otherwise a file the walk loaded AND an import names
        // lands in the prompt twice.
        alreadyLoaded: [...visited],
      }),
    )
    found.push(parts.filter(Boolean).join(SEPARATOR))
  }

  const joined = found.reverse().filter(Boolean).join(SEPARATOR)
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

function splitProjectDoc(doc: string): { rules: string; agentsMd: string } {
  const i = doc.indexOf(RULE_SEPARATOR)
  if (i < 0) return { rules: '', agentsMd: doc }
  const breakAt = doc.lastIndexOf('\n\n', i)
  return breakAt < 0
    ? { rules: doc, agentsMd: '' }
    : { agentsMd: doc.slice(0, breakAt), rules: doc.slice(breakAt + 2) }
}

function joinProjectDoc(rules: string, agentsMd: string): string {
  return [agentsMd, rules].filter((s) => s.length > 0).join('\n\n')
}

export function composeInstructions(
  base: string,
  projectDoc: string,
  surfaceDoc = '',
  opts?: AggregateBudget,
  /** Basenames the project document was read from, so the header can name them honestly. */
  sources?: readonly string[],
): ComposedInstructions {
  if (opts === undefined) return { text: build(base, projectDoc, surfaceDoc, sources), cuts: [] }
  if (opts.maxChars <= 0) {
    throw new RangeError(`maxChars=${String(opts.maxChars)} — the aggregate budget must be > 0`)
  }
  return withinBudget(base, projectDoc, surfaceDoc, opts, sources)
}

function withinBudget(
  base: string,
  projectDoc: string,
  surfaceDoc: string,
  opts: AggregateBudget,
  sources?: readonly string[],
): ComposedInstructions {
  let doc = projectDoc
  let surface = surfaceDoc
  const cuts: InstructionCut[] = []
  const total = (): number => build(base, doc, surface, sources).length

  if (total() > opts.maxChars) {
    const { rules, agentsMd } = splitProjectDoc(doc)
    const truncatedRules = trimBlocksFromStart(
      rules,
      Math.max(0, rules.length - (total() - opts.maxChars)),
    )
    if (truncatedRules.length !== rules.length) {
      cuts.push({ source: 'rules', from: rules.length, to: truncatedRules.length })
      opts.warn(
        `[instructions] source 'rules' truncated from ${String(rules.length)} to ` +
          `${String(truncatedRules.length)} chars (aggregate budget ${String(opts.maxChars)})`,
      )
    }
    doc = joinProjectDoc(truncatedRules, agentsMd)
  }
  if (total() > opts.maxChars) {
    const { rules, agentsMd } = splitProjectDoc(doc)
    const truncatedMd = agentsMd.slice(-Math.max(0, agentsMd.length - (total() - opts.maxChars)))
    if (truncatedMd.length !== agentsMd.length) {
      cuts.push({ source: 'agentsMd', from: agentsMd.length, to: truncatedMd.length })
      opts.warn(
        `[instructions] source 'agentsMd' truncated from ${String(agentsMd.length)} to ` +
          `${String(truncatedMd.length)} chars (aggregate budget ${String(opts.maxChars)})`,
      )
    }
    doc = joinProjectDoc(rules, truncatedMd)
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
  return { text: build(base, doc, surface, sources), cuts }
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
