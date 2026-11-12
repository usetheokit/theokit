import { existsSync, readFileSync } from 'node:fs'

import {
  assertNoSymlinkEscape,
  estimateTokens,
  isForbiddenPath,
  safePathJoin,
} from '@theokit/agents'

const MENTION_RE = /@([^\s]+)/g
const MAX_MENTION_TOKENS = 2000

const MAX_TOTAL_MENTION_TOKENS = 20_000

const TRAILING_PUNCTUATION_RE = /[,.;:)!?]+$/

function parseMentions(text: string): string[] {
  return Array.from(text.matchAll(MENTION_RE), (m) => m[1].replace(TRAILING_PUNCTUATION_RE, ''))
    .filter((ref) => ref.length > 0)
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

export function resolveMentions(text: string, cwd: string): ResolvedMentions {
  const seen = new Set<string>()
  const blocks: string[] = []
  const attached: string[] = []
  const skipped: SkippedMention[] = []
  let used = 0
  let didNotFit = 0

  for (const path of parseMentions(text)) {
    if (seen.has(path)) continue
    seen.add(path)
    try {
      if (isForbiddenPath(path)) {
        skipped.push({ ref: path, reason: 'path is not allowed' })
        continue
      }
      if (path.startsWith('~')) {
        skipped.push({ ref: path, reason: 'home-directory (~) paths are not supported' })
        continue
      }
      const abs = safePathJoin(cwd, path)
      assertNoSymlinkEscape(abs, cwd)
      if (!existsSync(abs)) {
        skipped.push({ ref: path, reason: 'file not found' })
        continue
      }
      let content = readFileSync(abs, 'utf8')
      if (estimateTokens(content) > MAX_MENTION_TOKENS) {
        content = `${content.slice(0, MAX_MENTION_TOKENS * 4)}\n…(truncated)`
      }
      const cost = estimateTokens(content)
      if (used + cost > MAX_TOTAL_MENTION_TOKENS) {
        didNotFit++
        skipped.push({ ref: path, reason: 'attachment budget reached' })
        continue
      }
      used += cost
      blocks.push(`--- ${path} ---\n${content}`)
      attached.push(path)
    } catch {
      // unresolvable / unsafe mention — reported to the user via `skipped`.
      skipped.push({ ref: path, reason: 'outside the workspace or unreadable' })
    }
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
