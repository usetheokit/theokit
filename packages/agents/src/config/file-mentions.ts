/**
 * `@file` mentions in a plain user message: find them, resolve them inside a working directory, cap
 * what is inlined, and say what was skipped.
 *
 * The grammar is the one `expandCommandTemplate` uses — one regex, owned here. A mention needs
 * whitespace or the start of the text before the `@`, and a trailing `.` or `,` is punctuation, not
 * part of the path. Two grammars that disagree is how `@src/a.ts,` attached in one surface and
 * silently did not in another.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { relative } from 'node:path'

import {
  assertNoSymlinkEscape,
  isForbiddenPath,
  PathTraversalError,
  safePathJoin,
} from '@theokit/sdk/path-safety'

import { estimateTokens } from '../guardrails/detectors.js'

/**
 * Shell segments and file references in ONE alternation (named groups `cmd` and `file`). Shell comes
 * first so `` !`grep @foo` `` is one segment, not a segment plus a reference. Both branches need
 * `(?<!\S)`. `expandCommandTemplate` scans with this directly so shell output and file content are
 * never rescanned; {@link findFileMentions} reads only the `file` branch.
 */
export const REFERENCE_REGEX = /(?<!\S)!`(?<cmd>[^`]+)`|(?<!\S)@(?<file>[^\s`,]*[^\s`,.])/g

/** The `@file` references in `text`, without the `@`, with the index of the `@`. */
export function findFileMentions(text: string): { ref: string; index: number }[] {
  const found: { ref: string; index: number }[] = []
  for (const match of text.matchAll(REFERENCE_REGEX)) {
    const ref = match.groups?.file
    if (ref !== undefined) found.push({ ref, index: match.index })
  }
  return found
}

export interface FileMentionOptions {
  cwd: string
  /** Default 2000 (about four characters each). A larger file is truncated, with a marker. */
  perFileTokens?: number
  /** Default 20000. A file that would exceed the total is skipped with reason `budget`. */
  totalTokens?: number
  /** Default false. When true, `~/` resolves under `os.homedir()` with the same symlink check. */
  allowHome?: boolean
  /** Injectable for tests. `undefined` means not found. */
  readFile?: (absPath: string) => string | undefined
}

export interface ResolvedFileMentions {
  /** The text plus the attached block, or the text unchanged when nothing was attached. */
  message: string
  attached: string[]
  skipped: {
    ref: string
    reason: 'forbidden' | 'outside-root' | 'not-found' | 'unreadable' | 'budget'
  }[]
}

/** Counted inside the per-file cap, so a truncated file never exceeds `perFileTokens`. */
const TRUNCATION_MARKER = '\n…(truncated)'

type Skip = ResolvedFileMentions['skipped'][number]['reason']

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'
  )
}

function defaultRead(abs: string): string | undefined {
  return readFileSync(abs, 'utf8')
}

function realpathOrUndefined(p: string): string | undefined {
  try {
    return realpathSync(p)
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

/** The absolute path a ref names, or why it cannot be read. */
function locate(ref: string, opts: FileMentionOptions): { abs: string } | { reason: Skip } {
  if (isForbiddenPath(ref)) return { reason: 'forbidden' }
  let base = opts.cwd
  let rel = ref
  if (ref.startsWith('~/')) {
    if (opts.allowHome !== true) return { reason: 'outside-root' }
    base = homedir()
    rel = ref.slice(2)
  }
  try {
    const abs = safePathJoin(base, rel)
    // Judged on the path as it will be opened, relative to its root: `~/.ssh/x` and
    // `dir/../.env` look harmless as written.
    if (isForbiddenPath(relative(base, abs))) return { reason: 'forbidden' }
    assertNoSymlinkEscape(abs, base)
    // A link inside cwd may point at a forbidden file (`notes.txt -> .env`): judge the target too.
    const realAbs = realpathOrUndefined(abs)
    const realBase = realpathOrUndefined(base)
    if (
      realAbs !== undefined &&
      realBase !== undefined &&
      isForbiddenPath(relative(realBase, realAbs))
    ) {
      return { reason: 'forbidden' }
    }
    return { abs }
  } catch (error) {
    if (error instanceof PathTraversalError) return { reason: 'outside-root' }
    throw error
  }
}

function read(
  abs: string,
  readFile: (p: string) => string | undefined,
): { content: string } | { reason: Skip } {
  try {
    const content = readFile(abs)
    return content === undefined ? { reason: 'not-found' } : { content }
  } catch (error) {
    if (isNotFound(error)) return { reason: 'not-found' }
    throw error
  }
}

/**
 * Attaches the files a message mentions with `@path`. Containment is `safePathJoin`,
 * `assertNoSymlinkEscape` and `isForbiddenPath`. Only those failures and a missing file become
 * `skipped` entries; any other error is rethrown.
 */
export function resolveFileMentions(text: string, opts: FileMentionOptions): ResolvedFileMentions {
  const perFile = opts.perFileTokens ?? 2000
  const total = opts.totalTokens ?? 20_000
  const readFile = opts.readFile ?? defaultRead
  const seen = new Set<string>()
  const blocks: string[] = []
  const attached: string[] = []
  const skipped: ResolvedFileMentions['skipped'] = []
  let used = 0
  let overBudget = 0

  for (const { ref } of findFileMentions(text)) {
    if (seen.has(ref)) continue
    seen.add(ref)
    const located = locate(ref, opts)
    if ('reason' in located) {
      skipped.push({ ref, reason: located.reason })
      continue
    }
    const raw = read(located.abs, readFile)
    if ('reason' in raw) {
      skipped.push({ ref, reason: raw.reason })
      continue
    }
    const truncated = estimateTokens(raw.content) > perFile
    if (truncated && perFile * 4 < TRUNCATION_MARKER.length) {
      // Not even the marker fits inside the cap: attach nothing rather than exceed it.
      skipped.push({ ref, reason: 'budget' })
      continue
    }
    const content = truncated
      ? `${raw.content.slice(0, Math.max(0, perFile * 4 - TRUNCATION_MARKER.length))}${TRUNCATION_MARKER}`
      : raw.content
    const cost = estimateTokens(content)
    if (used + cost > total) {
      overBudget++
      skipped.push({ ref, reason: 'budget' })
      continue
    }
    used += cost
    blocks.push(`--- ${ref} ---\n${content}`)
    attached.push(ref)
  }

  if (overBudget > 0) {
    blocks.push(
      `--- (attachment budget reached: ${String(attached.length)} of ` +
        `${String(attached.length + overBudget)} files attached — ${String(overBudget)} did ` +
        `not fit in ~${String(total)} tokens; mention fewer files) ---`,
    )
  }
  if (blocks.length === 0) return { message: text, attached, skipped }
  return { message: `${text}\n\n[Attached files]\n${blocks.join('\n\n')}`, attached, skipped }
}
