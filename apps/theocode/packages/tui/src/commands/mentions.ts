import { readFileSync } from 'node:fs'

import { resolveFileMentions } from '@theokit/agents/config'

/**
 * `@file` mentions in a user message, resolved by the framework's `resolveFileMentions`.
 *
 * This module only adapts the framework result to the wording the toast shows. The framework owns the
 * containment, the per-file and total budgets and the attachment block. Its grammar wants whitespace
 * before `@` and treats only `.` and `,` as trailing punctuation, while this product has always
 * accepted `(@src/a.ts)?`. {@link lenient} bridges that without touching the framework: it blanks the
 * characters the grammar would trip on, keeping every index, and the attachment is appended to the
 * ORIGINAL text.
 */

const MAX_MENTION_TOKENS = 2000
const MAX_TOTAL_MENTION_TOKENS = 20_000

interface SkippedMention {
  ref: string
  reason: string
}

export interface ResolvedMentions {
  message: string
  attached: string[]
  skipped: SkippedMention[]
}

const REASONS = {
  forbidden: 'forbidden path',
  'outside-root': 'unsafe or unreadable path (outside the working directory)',
  'not-found': 'file not found',
  unreadable: 'could not be read',
  budget: 'attachment budget reached',
} as const

/** A file that exists but cannot be read (a directory, no permission) is skipped, never thrown. */
function readOrUndefined(abs: string): string | undefined {
  try {
    return readFileSync(abs, 'utf8')
  } catch {
    return undefined
  }
}

const TRAILING_PUNCT_RE = /[,.;:)\]!?]+$/

/** `text` with the same length, where a glued `@` and trailing sentence punctuation are blanks. */
function lenient(text: string): string {
  return text
    .replace(/\S@(?=[^\s`,])/g, (m) => ` ${m.slice(1)}`)
    .replace(/@\S+/g, (m) => m.replace(TRAILING_PUNCT_RE, (p) => ' '.repeat(p.length)))
}

export function resolveMentions(text: string, cwd: string): ResolvedMentions {
  const probe = lenient(text)
  const r = resolveFileMentions(probe, {
    cwd,
    allowHome: true,
    perFileTokens: MAX_MENTION_TOKENS,
    totalTokens: MAX_TOTAL_MENTION_TOKENS,
    readFile: readOrUndefined,
  })
  return {
    message: r.message === probe ? text : `${text}${r.message.slice(probe.length)}`,
    attached: r.attached,
    skipped: r.skipped.map((s) => ({ ref: s.ref, reason: REASONS[s.reason] })),
  }
}
