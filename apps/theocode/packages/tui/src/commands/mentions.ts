import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

import {
  assertNoSymlinkEscape,
  estimateTokens,
  isForbiddenPath,
  safePathJoin,
} from '@theokit/agents'

const MENTION_RE = /@([^\s]+)/g
const MAX_MENTION_TOKENS = 2000

const MAX_TOTAL_MENTION_TOKENS = 20_000

function parseMentions(text: string): string[] {
  return Array.from(text.matchAll(MENTION_RE), (m) => m[1])
}

export interface SkippedMention {
  ref: string
  reason: string
}

export interface ResolvedMentions {
  message: string
  attached: string[]
  skipped: SkippedMention[]
}

const TRAILING_PUNCT_RE = /[,.;:)!?]+$/

/** `@~/x` is offered by the composer's `@` menu, so it resolves against the home directory. */
function resolveBase(path: string, cwd: string): { rel: string; base: string } {
  if (path.startsWith('~/')) return { rel: path.slice(2), base: homedir() }
  return { rel: path, base: cwd }
}

/** The file a path names, or the reason it cannot be attached. */
function locate(path: string, cwd: string): { abs: string } | { reason: string } {
  if (isForbiddenPath(path)) return { reason: 'forbidden path' }
  try {
    const { rel, base } = resolveBase(path, cwd)
    if (rel.length === 0) return { reason: 'not a file' }
    const abs = safePathJoin(base, rel)
    assertNoSymlinkEscape(abs, base)
    if (!existsSync(abs)) return { reason: 'file not found' }
    return { abs }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { reason: `unsafe or unreadable path (${detail})` }
  }
}

/** Try the token as written, then without trailing sentence punctuation. */
function locateMention(token: string, cwd: string): { path: string; abs: string } | SkippedMention {
  const stripped = token.replace(TRAILING_PUNCT_RE, '')
  const first = locate(token, cwd)
  if ('abs' in first) return { path: token, abs: first.abs }
  if (stripped === token || stripped.length === 0) return { ref: token, reason: first.reason }
  const second = locate(stripped, cwd)
  if ('abs' in second) return { path: stripped, abs: second.abs }
  return { ref: stripped, reason: second.reason }
}

export function resolveMentions(text: string, cwd: string): ResolvedMentions {
  const seen = new Set<string>()
  const blocks: string[] = []
  const attached: string[] = []
  const skipped: SkippedMention[] = []
  let used = 0
  let didNotFit = 0

  for (const token of parseMentions(text)) {
    if (seen.has(token)) continue
    seen.add(token)
    const found = locateMention(token, cwd)
    if (!('abs' in found)) {
      skipped.push(found)
      continue
    }
    if (attached.includes(found.path)) continue
    let content: string
    try {
      content = readFileSync(found.abs, 'utf8')
    } catch {
      skipped.push({ ref: found.path, reason: 'could not be read' })
      continue
    }
    if (estimateTokens(content) > MAX_MENTION_TOKENS) {
      content = `${content.slice(0, MAX_MENTION_TOKENS * 4)}\n…(truncated)`
    }
    const cost = estimateTokens(content)
    if (used + cost > MAX_TOTAL_MENTION_TOKENS) {
      didNotFit++
      skipped.push({ ref: found.path, reason: 'attachment budget reached' })
      continue
    }
    used += cost
    blocks.push(`--- ${found.path} ---\n${content}`)
    attached.push(found.path)
  }

  if (didNotFit > 0) {
    blocks.push(
      `--- (attachment budget reached: ${String(attached.length)} of ` +
        `${String(attached.length + didNotFit)} files attached — ${String(didNotFit)} did ` +
        `not fit in ~${String(MAX_TOTAL_MENTION_TOKENS)} tokens; mention fewer files or use grep) ---`,
    )
  }

  if (blocks.length === 0) return { message: text, attached: [], skipped }
  return { message: `${text}\n\n[Attached files]\n${blocks.join('\n\n')}`, attached, skipped }
}
