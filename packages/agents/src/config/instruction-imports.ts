/**
 * `@file.md` imports inside an instruction file.
 *
 * The loader walks directories and reads whole files; this is the second entry point a file can
 * open — a line saying `@./style.md` pulls that file's content into the prompt. Measured against the
 * closest real consumer, it is the half of the loader it had to keep writing itself, and its absence
 * is why migrating to the framework loader would have been a regression rather than an absorption.
 *
 * Its own module because `instruction-tree.ts` is at 293 of its 500-line budget (G6), and because
 * the expansion is pure: given text and a path, it answers with text. That makes it testable without
 * a walk, and keeps the walk readable without it.
 *
 * ## The three ways this goes wrong silently
 *
 * 1. **Expanding a reference that is not one.** `@foo.md` inside a fence or backticks is prose ABOUT
 *    the syntax. Expanding it rewrites the user's own documentation, and they find out by reading a
 *    prompt that no longer says what they wrote. So the scan runs over a MASKED copy — code spans
 *    blanked, offsets preserved — and slices from the original.
 * 2. **Following a reference out of the project.** An import is a second door into the filesystem,
 *    and it gets the same containment the walk enforces: resolved on the REAL path, refused when it
 *    lands outside, and kept literal rather than dropped so the user sees what did not expand.
 * 3. **Not terminating.** `a → b → a` produces infinitely many expansions, and the failure is a hung
 *    process rather than a wrong answer — the worst shape to debug from a bug report. Bounded by a
 *    visited set AND a depth cap, because they stop different things: the set stops revisits, the cap
 *    stops a long chain that never repeats.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Deeper than this and the reference is kept literal. Matches the depth a chain of includes needs. */
const MAX_IMPORT_DEPTH = 4

/**
 * `@` followed by a path ending in `.md`, not preceded by a word character or a backtick.
 *
 * The backtick guard is belt-and-braces beside the masking below: an inline span is already blanked,
 * and an `email@host.md`-shaped string is excluded by the word-character guard.
 */
const IMPORT_REGEX = /(?<![\w`])@([\w~./-]+\.md)\b/g

/**
 * Blank out fenced blocks and inline code, preserving length so match offsets still index the
 * original text. Newlines survive so a fence's line structure is unchanged.
 */
function maskCodeSpans(text: string): string {
  return text
    .replace(/```[\s\S]*?(```|$)/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length))
}

/** True when `target` resolves, on the real path, to something inside `rootDir`. */
function insideRoot(target: string, rootDir: string): boolean {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- resolving the import the user wrote, against the root the caller declared; refusing dynamic paths here would refuse every import
    const real = realpathSync(target)
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the caller's own project root
    const realRoot = realpathSync(rootDir)
    return real === realRoot || real.startsWith(`${realRoot}/`)
  } catch {
    // A path that cannot be resolved is a path we cannot vouch for.
    return false
  }
}

/**
 * The file an import names, or `undefined` when it must stay literal.
 *
 * Existence is checked BEFORE containment on purpose: `insideRoot` resolves symlinks, and a path
 * that is not there cannot be resolved — checking the other way round reports every missing import
 * as an escape attempt, which sends the reader looking for a security problem that is a typo.
 */
function importTarget(
  name: string,
  filePath: string,
  rootDir: string,
  visited: ReadonlySet<string>,
  warn: (message: string) => void,
): string | undefined {
  if (name.startsWith('~/')) {
    warn(`instruction import @${name} in ${filePath} is outside the project root — kept literal`)
    return undefined
  }
  const target = resolve(dirname(filePath), name)
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the import the user wrote, inside their own project
  if (!existsSync(target)) {
    warn(`instruction import @${name} in ${filePath} was not found — kept literal`)
    return undefined
  }
  if (!insideRoot(target, rootDir)) {
    warn(`instruction import @${name} in ${filePath} is outside the project root — kept literal`)
    return undefined
  }
  // Already expanded on this branch: stop, without a warning. A diamond (`a` and `b` both importing
  // `c`) is ordinary authoring, not a mistake to report.
  return visited.has(target) ? undefined : target
}

export interface ExpandImportsInput {
  readonly text: string
  /** Absolute path of the file `text` came from — imports resolve relative to its directory. */
  readonly filePath: string
  /** Containment boundary. An import resolving outside it is kept literal. */
  readonly rootDir: string
  readonly onWarn: (message: string) => void
}

/**
 * Replace every `@file.md` reference with that file's content, recursively.
 *
 * A reference that cannot be expanded — missing, outside the root, too deep, already visited — is
 * left exactly as written. Keeping it literal rather than dropping it is what lets a user SEE that
 * something did not expand; a silently deleted line reads as content nobody wrote.
 */
export function expandInstructionImports(input: ExpandImportsInput): string {
  return expand(input.text, input.filePath, {
    rootDir: input.rootDir,
    warn: input.onWarn,
    visited: new Set(),
    depth: 0,
  })
}

/** What every level of the recursion shares. Grouped so the recursive call reads as one decision. */
interface ExpandContext {
  readonly rootDir: string
  readonly warn: (message: string) => void
  /** Files already expanded on this branch. Mutated across the whole walk, by design. */
  readonly visited: Set<string>
  readonly depth: number
}

function expand(text: string, filePath: string, ctx: ExpandContext): string {
  const masked = maskCodeSpans(text)
  const matches = [...masked.matchAll(IMPORT_REGEX)]
  if (matches.length === 0) return text

  if (ctx.depth >= MAX_IMPORT_DEPTH) {
    ctx.warn(
      `instruction import depth cap (${String(MAX_IMPORT_DEPTH)}) reached in ${filePath} — deeper imports kept literal`,
    )
    return text
  }

  const out: string[] = []
  let cursor = 0
  for (const match of matches) {
    // `match[1]` is the capture group; the regex cannot match without it participating, which is
    // why the types call it a `string` and a guard here would be dead code.
    const name = match[1]
    out.push(text.slice(cursor, match.index))
    cursor = match.index + match[0].length

    const target = importTarget(name, filePath, ctx.rootDir, ctx.visited, ctx.warn)
    if (target === undefined) {
      out.push(match[0])
      continue
    }

    ctx.visited.add(target)
    let content: string
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- a path already proven to exist and to be inside the declared root
      content = readFileSync(target, 'utf8')
    } catch {
      ctx.warn(`instruction import @${name} in ${filePath} could not be read — kept literal`)
      out.push(match[0])
      continue
    }
    out.push(expand(content, target, { ...ctx, depth: ctx.depth + 1 }))
  }
  out.push(text.slice(cursor))
  return out.join('')
}
