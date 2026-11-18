/* eslint-disable security/detect-non-literal-fs-filename --
 * Resolving a path the user typed is the feature. Containment is `safePathJoin` plus
 * `assertNoSymlinkEscape`, and `isForbiddenPath` runs first.
 */
import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { relative } from 'node:path'

import {
  assertNoSymlinkEscape,
  ForbiddenPathError,
  isForbiddenPath,
  PathTraversalError,
  safePathJoin,
} from '@theokit/sdk/path-safety'

/**
 * Shell segments and file references in ONE alternation, matched left to right in a single scan.
 * Shared by `expandCommandTemplate` and `findFileMentions` so both agree on what a reference is.
 * The `@file` branch needs whitespace or start of line before the `@` and drops a trailing `.` or `,`.
 * Shell comes first so `` !`grep @foo` `` is one segment rather than a segment plus a reference.
 */
export const REFERENCE_REGEX = /(?<!\S)!`(?<cmd>[^`]+)`|(?<!\S)@(?<file>[^\s`,]*[^\s`,.])/g

/** The `@file` references in `text`, in order, with the index of each match. */
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
  /** Default 2000 (about four characters each). A longer file is truncated. */
  perFileTokens?: number
  /** Default 20000, over everything attached. */
  totalTokens?: number
  /** Default false. When true, `~/` resolves under `os.homedir()` with the same symlink check. */
  allowHome?: boolean
  /** Injectable for tests. `undefined` = not found. */
  readFile?: (absPath: string) => string | undefined
}

export interface ResolvedFileMentions {
  /** The text plus the attached block, or the text unchanged. */
  message: string
  attached: string[]
  skipped: {
    ref: string
    reason: 'forbidden' | 'outside-root' | 'not-found' | 'unreadable' | 'budget'
  }[]
}

type SkipReason = ResolvedFileMentions['skipped'][number]['reason']

const CHARS_PER_TOKEN = 4
const estimate = (s: string): number => Math.ceil(s.length / CHARS_PER_TOKEN)

function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

function defaultRead(abs: string): string | undefined {
  return readFileSync(abs, 'utf8')
}

/** Forbidden-ness of a path relative to its root, after `..` and symlinks are resolved. */
function forbiddenUnder(root: string, abs: string): boolean {
  const rel = relative(root, abs)
  return rel.length > 0 && isForbiddenPath(rel)
}

function realOrUndefined(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return undefined
    throw error
  }
}

/** The absolute path a reference names, or why it cannot be read. */
function locate(ref: string, opts: FileMentionOptions): { abs: string } | { reason: SkipReason } {
  if (isForbiddenPath(ref)) return { reason: 'forbidden' }
  let base = opts.cwd
  let rel = ref
  if (ref.startsWith('~/')) {
    if (opts.allowHome !== true) return { reason: 'outside-root' }
    base = homedir()
    rel = ref.slice(2)
  }
  if (rel.length === 0) return { reason: 'not-found' }
  try {
    const abs = safePathJoin(base, rel)
    // Check the normalized path against the root: `sub/../.env` and `~/.ssh/x` hide the name
    // from a first-segment check on the raw reference.
    if (isForbiddenPath(rel) || forbiddenUnder(base, abs)) return { reason: 'forbidden' }
    assertNoSymlinkEscape(abs, base)
    // A symlink inside the root may point at a forbidden file inside the root.
    const realAbs = realOrUndefined(abs)
    const realBase = realOrUndefined(base)
    if (realAbs !== undefined && realBase !== undefined && forbiddenUnder(realBase, realAbs)) {
      return { reason: 'forbidden' }
    }
    return { abs }
  } catch (error) {
    if (error instanceof ForbiddenPathError) return { reason: 'forbidden' }
    if (error instanceof PathTraversalError) return { reason: 'outside-root' }
    if (codeOf(error) === 'ENOENT') return { reason: 'not-found' }
    throw error
  }
}

type ReadOutcome = { ok: true; text: string } | { ok: false; reason: SkipReason }

/** The file's text, or `not-found` for ENOENT. Every other error is rethrown. */
function readMention(read: (abs: string) => string | undefined, abs: string): ReadOutcome {
  try {
    const text = read(abs)
    return text === undefined ? { ok: false, reason: 'not-found' } : { ok: true, text }
  } catch (error) {
    if (codeOf(error) === 'ENOENT') return { ok: false, reason: 'not-found' }
    throw error
  }
}

/**
 * Attaches the files `@mentions` in `text` name, using the grammar `expandCommandTemplate` uses.
 * A mention that was not attached is reported in `skipped`; the text itself is never rewritten.
 * Only containment failures and ENOENT are reported — any other error is rethrown.
 */
export function resolveFileMentions(text: string, opts: FileMentionOptions): ResolvedFileMentions {
  const perFile = opts.perFileTokens ?? 2000
  const total = opts.totalTokens ?? 20_000
  const read = opts.readFile ?? defaultRead
  const seen = new Set<string>()
  const blocks: string[] = []
  const attached: string[] = []
  const skipped: ResolvedFileMentions['skipped'] = []
  let used = 0

  for (const { ref } of findFileMentions(text)) {
    if (seen.has(ref)) continue
    seen.add(ref)
    const found = locate(ref, opts)
    if ('reason' in found) {
      skipped.push({ ref, reason: found.reason })
      continue
    }
    const outcome = readMention(read, found.abs)
    if (!outcome.ok) {
      skipped.push({ ref, reason: outcome.reason })
      continue
    }
    let content = outcome.text
    if (estimate(content) > perFile) {
      content = `${content.slice(0, perFile * CHARS_PER_TOKEN)}\n…(truncated)`
    }
    const cost = estimate(content)
    if (used + cost > total) {
      skipped.push({ ref, reason: 'budget' })
      continue
    }
    used += cost
    blocks.push(`--- ${ref} ---\n${content}`)
    attached.push(ref)
  }

  const overflow = skipped.filter((s) => s.reason === 'budget').length
  if (overflow > 0) {
    blocks.push(
      `--- (attachment budget reached: ${String(attached.length)} of ` +
        `${String(attached.length + overflow)} files attached — ${String(overflow)} did ` +
        `not fit in ~${String(total)} tokens; mention fewer files or use grep) ---`,
    )
  }
  if (blocks.length === 0) return { message: text, attached, skipped }
  return { message: `${text}\n\n[Attached files]\n${blocks.join('\n\n')}`, attached, skipped }
}
