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

const TRAILING_PUNCTUATION_RE = /[,.;:)!?\]}'"]+$/

/** A path with trailing sentence punctuation removed — unless the token as written exists. */
function stripPunctuation(token: string, root: string): string {
  const stripped = token.replace(TRAILING_PUNCTUATION_RE, '')
  if (stripped === token || stripped.length === 0) return token
  return existsSync(locate(token, root)) ? token : stripped
}

/** `~/x` (offered by the composer's `@` menu) is relative to the home directory. */
function locate(path: string, cwd: string): string {
  return path.startsWith('~/') ? safePathJoin(homedir(), path.slice(2)) : safePathJoin(cwd, path)
}

/** Read one mention's content, or return the reason it cannot be attached. */
function readMention(path: string, cwd: string): { content: string } | { reason: string } {
  try {
    if (isForbiddenPath(path)) return { reason: 'forbidden path' }
    // Home holds credentials (~/.ssh, ~/.theocode/auth.json…): refuse any hidden segment there.
    if (path.startsWith('~/') && path.split('/').some((seg) => seg.startsWith('.') && seg !== '')) {
      return { reason: 'hidden paths under ~ are not attached' }
    }
    const abs = locate(path, cwd)
    assertNoSymlinkEscape(abs, path.startsWith('~/') ? homedir() : cwd)
    if (!existsSync(abs)) return { reason: 'file not found' }
    let content = readFileSync(abs, 'utf8')
    if (estimateTokens(content) > MAX_MENTION_TOKENS) {
      content = `${content.slice(0, MAX_MENTION_TOKENS * 4)}\n…(truncated)`
    }
    return { content }
  } catch (err) {
    return { reason: err instanceof Error ? err.message : 'could not be read' }
  }
}

function cleanToken(token: string, cwd: string): string {
  try {
    return stripPunctuation(token, cwd)
  } catch {
    return token
  }
}

export function resolveMentions(text: string, cwd: string): ResolvedMentions {
  const seen = new Set<string>()
  const blocks: string[] = []
  const attached: string[] = []
  const skipped: SkippedMention[] = []
  let used = 0
  let didNotFit = 0

  for (const token of parseMentions(text)) {
    const path = cleanToken(token, cwd)
    if (seen.has(path)) continue
    seen.add(path)
    const read = readMention(path, cwd)
    if ('reason' in read) {
      // The raw @token stays in the message text; the caller tells the user it was not attached.
      skipped.push({ ref: `@${path}`, reason: read.reason })
      continue
    }
    const cost = estimateTokens(read.content)
    if (used + cost > MAX_TOTAL_MENTION_TOKENS) {
      didNotFit++
      skipped.push({ ref: `@${path}`, reason: 'attachment budget reached' })
      continue
    }
    used += cost
    blocks.push(`--- ${path} ---\n${read.content}`)
    attached.push(path)
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
