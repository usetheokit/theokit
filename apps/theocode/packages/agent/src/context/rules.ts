import { realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'

import { loadInstructionTree } from '@theokit/agents/config'

import { DEFAULT_HOME_DIR, LEGACY_HOME_DIR, homeStateDir } from '../config/home-dir.js'

type WarnFn = (message: string) => void

const MAX_CHARS = 64_000
const SEPARATOR = '\n\n---\n\n'

export interface TraversalBudget {
  maxDepth: number
  maxFiles: number
}

const DEFAULT_BUDGET: TraversalBudget = { maxDepth: 32, maxFiles: 2_000 }

/**
 * `.theokit/rules/` — every markdown file under it, assembled into one block of guidance.
 *
 * ## What moved, and why it was never ours
 *
 * This file owned a directory walk (depth ceiling, file ceiling, inode-keyed cycle guard,
 * unreadable-entry tolerance) and a frontmatter parser (`paths:` extraction, unclosed-frontmatter
 * detection). Both are `@theokit/agents/config` now, through `loadInstructionTree`, which returns
 * `{ path, content, scopes, scopesUnreadable }` per file with the frontmatter already handled.
 *
 * The walk was never product knowledge — it answers "how do I read a tree of instruction files
 * without following a symlink loop", the same question in every agent. It lived here because the
 * framework's version could not be asked what a rules folder asks: it matched file NAMES exactly,
 * and a rules folder holds files the user names.
 *
 * ## The four things that had to become true before this could move
 *
 * 1. **The file set.** `fileNames` takes a predicate, so `entry.endsWith('.md')` is expressible.
 * 2. **The order.** A rules folder is not an instruction tree. There the outer file states the rule
 *    and the inner refines it, so files come before subdirectories; here the files are peers and the
 *    contract is one alphabetical pass — the same directory assembling the same prompt on any
 *    machine. `order: 'lexicographic'` is that contract, kept rather than traded away.
 * 3. **The two ceilings.** `budget.maxChars` bounds the WALK, in raw bytes including frontmatter
 *    that never reaches the prompt. `MAX_CHARS` bounds the PROMPT. Passing the second as the first
 *    stops reading early, and the assembled text falls short of its own budget for the wrong reason.
 * 4. **The scope.** `scopes: []` means both "no scope declared" and "a `paths:` we could not read",
 *    and only `scopesUnreadable` separates them — see {@link scopedBlock}.
 *
 * ## What stays, and why
 *
 * The BLOCK FORMAT and the prompt ceiling. `> Applies ONLY to files matching: …` is this product's
 * prompt, read by this product's model; the framework hands over the scopes, and what a scope should
 * SAY is not a decision it can make for us.
 */
/**
 * #91 — what a caller needs to say whether the rules in the prompt are the rules on disk.
 *
 * `count` alone was already available and was never enough: "12 rules" describes a complete load
 * and a quarter of one identically. The comparison is the fact, so both halves travel together.
 */
export interface RulesLoad {
  /** The block as it goes into the prompt — already sliced at the ceiling. */
  readonly text: string
  /** Blocks that CONTRIBUTED to `text`. Unchanged meaning; see `assemble`. */
  readonly count: number
  /** Blocks READ from disk. Equal to `count` when nothing was dropped. */
  readonly read: number
  /** Length BEFORE the slice — what would have been in the prompt with no ceiling. */
  readonly chars: number
  /**
   * Length that actually reached the prompt. Equal to `chars` when nothing was dropped.
   *
   * Carried rather than left to a caller to derive from the ceiling: a surface that recomputed the
   * loss from `MAX_CHARS` would hold a second copy of the ceiling and print a wrong percentage the
   * day it moved.
   */
  readonly kept: number
  /** Derived, and stated rather than left to the caller to infer from `read > count`. */
  readonly truncated: boolean
}

export function loadRules(
  cwd: string,
  warn: WarnFn = (m) => process.stderr.write(`${m}\n`),
  budget: TraversalBudget = DEFAULT_BUDGET,
): RulesLoad {
  return loadRulesFrom(cwd, [join('.theokit', 'rules'), CLAUDE_RULES], warn, budget)
}

/**
 * The operator's own rules — the unified state directory, the one before it, and `~/.claude/rules/`.
 *
 * All three are read, and additively: a rules directory is a SET, so dropping one because another
 * directory also has rules would silently disable a rule the operator wrote. That is the opposite
 * choice from `AGENTS.md`, which is one document under several names and is therefore first-wins.
 *
 * `#65` argued for `.theocode` alone — "what this product owns in the operator's home is
 * `.theocode/`" — and #72 reverses it: `home_dir` names ONE root now, and a second root that key
 * cannot reach makes it a half-truth. The old root is still read, so nothing an operator wrote stops
 * being applied.
 *
 * Read OUTSIDE the trust gate, for the reason `user-agents-md.ts` sets out at length: that gate asks
 * whether this repository's code is trusted, and nobody's home directory is the repository.
 *
 * Read OUTSIDE the trust gate, for the reason `user-agents-md.ts` sets out at length: that gate asks
 * whether this repository's code is trusted, and nobody's home directory is the repository.
 */
/**
 * The rule directories under the operator's home, as NAMES relative to it.
 *
 * Relative, and measured rather than assumed: `loadInstructionTree` resolves a root against `cwd`
 * and returns `count: 0` for an absolute one — probed 2026-09-04 against `@theokit/agents@12.1.0`.
 * Passing `homeStateDir()` straight through would therefore have read nothing, silently, which is
 * the failure shape this whole issue is about.
 *
 * The configured root is included only when it IS a directory under the operator's home. An
 * explicit `THEOKIT_HOME` pointing elsewhere has no name relative to home, and inventing one would
 * escape the confinement the traversal depends on; the three known names still apply.
 */
function userRuleRoots(
  home: string,
  env: Record<string, string | undefined> = process.env,
): readonly string[] {
  const configured = relative(home, homeStateDir(env, home))
  const names = [DEFAULT_HOME_DIR, LEGACY_HOME_DIR]
  if (configured.length > 0 && !configured.startsWith('..') && !isAbsolute(configured)) {
    names.unshift(configured)
  }
  return [...new Set([...names.map((n) => join(n, 'rules')), CLAUDE_RULES])]
}

export function loadUserRules(
  home: string,
  warn: WarnFn = (m) => process.stderr.write(`${m}\n`),
  budget: TraversalBudget = DEFAULT_BUDGET,
): RulesLoad {
  const blocks = [...blocksFrom(home, userRuleRoots(home), warn, budget)]

  // B-171 — the state directory may sit outside the home, and every other consumer follows it there:
  // config, the trust store, MCP scopes all resolve through `homeStateDir`. Rules were the outlier,
  // so one build could serve config from `$THEOKIT_HOME` and instructions from `~/.theokit`.
  //
  // Collected as blocks and assembled ONCE below, never assembled separately and merged: the ceiling
  // belongs to the PROMPT, so applying it per-load lets two corpora that each fit produce a prompt
  // that does not. The first attempt at this item did exactly that — 126,012 chars against a declared
  // 64,000, with `truncated` reporting false — and was reversed for it.
  //
  // A base of its own rather than another root NAME, because `loadInstructionTree` joins names
  // against a base and `join('/home/op', '/srv/state/rules')` is `/home/op/srv/state/rules`.
  // Compared by REAL path, not by text. `loadInstructionTree`'s cycle guard is per CALL, so splitting
  // into two calls removed the only thing stopping the same tree being walked twice — and a home
  // reachable by two paths is ordinary, not exotic: `/home -> /var/home` on Fedora Silverblue,
  // systemd-homed, any symlinked `$HOME`. Measured on this shape before the fix: two rule files came
  // back as `read=4`, and a corpus that fit began truncating, dropping one of the operator's files.
  const stateDir = realPath(homeStateDir(process.env, home))
  const outside = relative(realPath(home), stateDir)
  if (outside.length === 0 || outside.startsWith('..') || isAbsolute(outside)) {
    blocks.push(...blocksFrom(stateDir, ['rules'], warn, budget))
  }

  return assemble(blocks, warn)
}

/**
 * #72 — the directory a Claude Code repository already keeps its rules in.
 *
 * Read ALONGSIDE ours, never instead: a rules directory is a SET, and Claude Code loads every `.md`
 * under it exactly as this product does under its own. A repository that has both meant both, which
 * is the opposite of the instruction chain — one document steering the agent, where a second one
 * silently shadowing the first is the confusion `THEO.md > AGENTS.md > CLAUDE.md` exists to prevent.
 *
 * Ours is walked FIRST because `loadInstructionTree` documents the order as the caller's, and with
 * additive loading that decides the order in the prompt rather than what gets read at all.
 */
const CLAUDE_RULES = join('.claude', 'rules')

function loadRulesFrom(
  cwd: string,
  roots: readonly string[],
  warn: WarnFn,
  budget: TraversalBudget,
): RulesLoad {
  return assemble(blocksFrom(cwd, roots, warn, budget), warn)
}

/**
 * A path with its symlinks resolved, or the path itself when it does not exist.
 *
 * Falling back rather than throwing: an operator may point `$THEOKIT_HOME` at a directory they have
 * not created yet, and a missing rules directory is the ordinary case the loader already tolerates.
 * Refusing to start over it would turn a shrug into a crash.
 */
function realPath(candidate: string): string {
  try {
    return realpathSync(candidate)
  } catch {
    return candidate
  }
}

/**
 * The blocks under one base, WITHOUT assembling them.
 *
 * B-171 — split out so a caller reading two bases assembles ONCE. A first attempt assembled each and
 * merged the results, which defeated the 64,000-char prompt ceiling: two corpora that each fit
 * produced 126,012 chars with `truncated: false`, measured. The ceiling belongs to the prompt, so it
 * has to be applied to everything that reaches it, together.
 */
function blocksFrom(cwd: string, roots: readonly string[], warn: WarnFn, budget: TraversalBudget): readonly string[] {
  requirePositiveBudget(budget)

  const tree = loadInstructionTree({
    cwd,
    roots,
    budget: { maxDepth: budget.maxDepth, maxFiles: budget.maxFiles, maxChars: Number.MAX_SAFE_INTEGER },
    onWarn: (message) => {
      warn(`[rules] ${message}`)
    },
    fileNames: (entry) => entry.endsWith('.md'),
    order: 'lexicographic',
  })

  return tree.blocks.map(scopedBlock).filter((block) => block.length > 0)
}

/**
 * Join the blocks that fit, and say what did not.
 *
 * ## Whole blocks only
 *
 * This used to slice the joined text at the ceiling, mid-block on purpose — the argument being that
 * "filling the budget beats stopping short of it, because the rules a user wrote are worth more to
 * the model than a tidy boundary."
 *
 * B-157 measured what the trade actually costs. In this repository's own checkout the block ended:
 *
 *   "## Modes\n\nEvery mode measures **our** system. They differ in what counts as a measure"
 *
 * Mid-word. The price is not a tidy boundary — it is a rule the model reads as complete when it is
 * a fragment, with nothing in the text marking where the author stopped and the cut began. A rule
 * that is absent is one the model cannot follow; a rule that is half-present is one it follows
 * wrongly while believing it has the whole thing.
 *
 * ## The omission is announced, to the MODEL
 *
 * `/status` reports the loss to the operator (#91). Nothing reported it inside the prompt, so the
 * model reasoned as though it held the whole corpus — and an agent that believes its instructions
 * are complete draws conclusions from their silence. One line changes what an absence can mean.
 *
 * `count` remains the number of blocks that CONTRIBUTED, which is now exactly the number that fit.
 */
function assemble(blocks: readonly string[], warn: WarnFn): RulesLoad {
  const full = blocks.join(SEPARATOR)
  const read = blocks.length
  if (full.length <= MAX_CHARS) {
    return { text: full, count: read, read, chars: full.length, kept: full.length, truncated: false }
  }

  // Reserve room for the notice before choosing what fits, so adding it can never be what pushes
  // the block over — a marker that itself caused a further drop would be its own small lie.
  const budget = MAX_CHARS - OMISSION_MAX
  const kept: string[] = []
  let used = 0
  for (const block of blocks) {
    const cost = block.length + (kept.length > 0 ? SEPARATOR.length : 0)
    if (used + cost > budget) break
    kept.push(block)
    used += cost
  }

  warn(`[rules] rules block truncated to ${String(MAX_CHARS)} chars (was ${String(full.length)})`)
  const text = [...kept, omissionNotice(read - kept.length, read)].join(SEPARATOR)
  return { text, count: kept.length, read, chars: full.length, kept: text.length, truncated: true }
}

/** Bounded so the reservation above is a fact rather than an estimate. */
const OMISSION_MAX = 200

function omissionNotice(dropped: number, read: number): string {
  return (
    `> NOTE: ${String(dropped)} of ${String(read)} rule file(s) were omitted for length. ` +
    'Your instructions are INCOMPLETE — do not treat the absence of a rule as permission.'
  )
}

/**
 * How a scope is announced to the model.
 *
 * FAIL CLOSED on a scope that was declared and could not be read. `scopes: []` means two different
 * things — "no scope declared" and "a `paths:` we could not parse" — and only the flag separates
 * them. Rendering the second as unscoped takes a rule written for one subtree and applies it to
 * every file, silently. A dropped rule is one the author notices missing; a widened one is one
 * nobody sees widen.
 */
function scopedBlock(block: {
  readonly content: string
  readonly scopes: readonly string[]
  readonly scopesUnreadable: boolean
}): string {
  if (block.scopesUnreadable) return ''

  const body = block.content.trim()
  if (body.length === 0) return ''
  return block.scopes.length > 0
    ? `> Applies ONLY to files matching: ${block.scopes.join(', ')}\n\n${body}`
    : body
}

function requirePositiveBudget(budget: TraversalBudget): void {
  if (budget.maxDepth <= 0 || budget.maxFiles <= 0) {
    throw new RangeError(
      `invalid traversal budget: maxDepth=${String(budget.maxDepth)}, ` +
        `maxFiles=${String(budget.maxFiles)} — both must be > 0`,
    )
  }
}
