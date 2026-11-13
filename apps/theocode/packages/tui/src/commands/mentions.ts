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

function parseMentions(text: string): string[] {
  return Array.from(text.matchAll(MENTION_RE), (m) => m[1])
}

export interface ResolvedMentions {
  message: string
  attached: string[]
}

export function resolveMentions(text: string, cwd: string): ResolvedMentions {
  const seen = new Set<string>()
  const blocks: string[] = []
  const attached: string[] = []
  let used = 0
  let didNotFit = 0

  for (const path of parseMentions(text)) {
    if (seen.has(path)) continue
    seen.add(path)
    try {
      if (isForbiddenPath(path)) continue
      const abs = safePathJoin(cwd, path)
      assertNoSymlinkEscape(abs, cwd)
      if (!existsSync(abs)) continue
      let content = readFileSync(abs, 'utf8')
      if (estimateTokens(content) > MAX_MENTION_TOKENS) {
        content = `${content.slice(0, MAX_MENTION_TOKENS * 4)}\n…(truncated)`
      }
      const cost = estimateTokens(content)
      if (used + cost > MAX_TOTAL_MENTION_TOKENS) {
        didNotFit++
        continue
      }
      used += cost
      blocks.push(`--- ${path} ---\n${content}`)
      attached.push(path)
    } catch {
      // unresolvable / unsafe mention — skip it silently (the raw @token stays in the message text).
    }
  }

  if (didNotFit > 0) {
    blocks.push(
      `--- (attachment budget reached: ${String(attached.length)} of ` +
        `${String(attached.length + didNotFit)} files attached — ${String(didNotFit)} did ` +
        `not fit in ~${String(MAX_TOTAL_MENTION_TOKENS)} tokens; mention fewer files or use grep) ---`,
    )
  }

  if (blocks.length === 0) return { message: text, attached: [] }
  return { message: `${text}\n\n[Attached files]\n${blocks.join('\n\n')}`, attached }
}
