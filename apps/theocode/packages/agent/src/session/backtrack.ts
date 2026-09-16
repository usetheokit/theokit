import { existsSync, mkdirSync, statSync } from 'node:fs'

import { dirname } from 'node:path'

import {
  forkTranscript,
  loadJsonl,
  type TranscriptBlock,
  transcriptPath,
  transcriptRoot,
} from '@theokit/agents/persistence'

import { protectedSessions } from './session-ops.js'
import type { SessionRecord } from '@theokit/agents'

const defaultBaseDir = transcriptRoot

let cacheTranscript: { key: string; records: readonly SessionRecord[] } | undefined

function readTranscript(src: string): readonly SessionRecord[] {
  const st = statSync(src)
  const key = `${src}:${String(st.mtimeMs)}:${String(st.size)}`
  if (cacheTranscript?.key === key) return cacheTranscript.records
  // B-012 — the SDK's reader. It ships the truncated-last-line tolerance as a documented opt-in and
  // throws `JsonlParseError` carrying the 1-based line, where the hand-rolled version threw a bare
  // SyntaxError and the surface could only report "transcript unreadable".
  const records = Object.freeze(
    loadJsonl<SessionRecord>(src, { tolerateTrailingPartialLine: true }),
  )
  cacheTranscript = { key, records }
  return records
}

function textOf(record: SessionRecord): string {
  return textBlocks(record).join('')
}

function textBlocks(record: SessionRecord): string[] {
  // B-012 — no cast. `TranscriptMessage.content` is a discriminated union in the SDK now; widening
  // it back erased the discriminant, so a hand-written predicate replaced narrowing the compiler
  // does for free, and a new block variant would produce no error here.
  const content = record.message?.content ?? []
  return content
    .filter((p): p is Extract<TranscriptBlock, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
}

function isRealUserTurn(record: SessionRecord): boolean {
  if (record.type !== 'user') return false
  const hasText = textBlocks(record).some((t) => t.length > 0)
  if (!hasText) return false
  return !textOf(record).startsWith('[[theokit:goal-continuation]]')
}

interface TruncationResult {
  prefix: SessionRecord[]
  selectedText: string
}

/**
 * B-036 — `readJsonlTail` is NOT adopted here, and this is the measured reason rather than an
 * omission.
 *
 * The SDK offers it to read the last records of a JSONL without loading the file, and its
 * `sinceMarker` option looks like an exact fit for `compact_boundary`. Two things argue against it:
 *
 *  - `sinceMarker` is a SUBSTRING match on the raw line. A user message containing the literal text
 *    `compact_boundary` would end the read early and silently shrink the backtrack window — a
 *    correctness defect traded for a performance win.
 *  - There is no performance win to trade for. Measured 2026-08-08 across the 23,100 transcripts on
 *    a real machine: the LARGEST is 186 KiB. Loading that to show a few turn previews is not a cost.
 *
 * If a transcript ever grows to where this matters, `maxRecords` alone (no marker) is the safe form,
 * and the trade is then against a number instead of a guess.
 */

/**
 * The indices of the real user turns in the CURRENT window — everything after the last
 * `compact_boundary`, or the whole transcript when there is none.
 *
 * B-036 — one definition. This loop appeared verbatim three times (truncate, count, previews), which
 * is duplicated KNOWLEDGE rather than duplicated code: "the current window" is one rule, and three
 * copies means changing it takes three edits and one of them gets missed. That is the shape B-012
 * asked to close and did not.
 */
function userTurnIndicesInWindow(records: readonly SessionRecord[]): number[] {
  let floor = -1
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].type === 'system' && records[i].subtype === 'compact_boundary') {
      floor = i
      break
    }
  }
  const indices: number[] = []
  for (let i = floor + 1; i < records.length; i++) {
    if (isRealUserTurn(records[i])) indices.push(i)
  }
  return indices
}

function truncateRecordsBeforeUserTurn(
  records: readonly SessionRecord[],
  nth: number,
): TruncationResult {
  const userIdx = userTurnIndicesInWindow(records)
  if (!Number.isInteger(nth) || nth < 0 || nth >= userIdx.length) {
    throw new RangeError(
      `backtrack: nth=${nth} out of range — ${userIdx.length} user turn(s) in the window`,
    )
  }
  const cut = userIdx[nth]
  return { prefix: records.slice(0, cut), selectedText: textOf(records[cut]) }
}

export interface ForkBeforeResult {
  newId: string
  copied: boolean
  selectedText?: string
}

export function forkSessionBeforeUserTurn(
  srcId: string,
  newId: string,
  nth: number,
  opts: { cwd?: string; baseDir?: string } = {},
): ForkBeforeResult {
  const cwd = opts.cwd ?? process.cwd()
  const dir = opts.baseDir ?? defaultBaseDir()
  const src = transcriptPath(dir, cwd, srcId)
  if (!existsSync(src)) return { newId, copied: false }

  const records = readTranscript(src)

  const { prefix, selectedText } = truncateRecordsBeforeUserTurn(records, nth)

  const dst = transcriptPath(dir, cwd, newId)
  mkdirSync(dirname(dst), { recursive: true })
  forkTranscript(src, dst, {
    beforeRecordIndex: prefix.length,
    liveSessionPaths: protectedSessions(cwd, dir),
  })
  return { newId, copied: true, selectedText }
}

function userTurnPreviews(records: readonly SessionRecord[]): string[] {
  return userTurnIndicesInWindow(records).map((i) => textOf(records[i]))
}

async function readTranscriptAsync(src: string): Promise<readonly SessionRecord[]> {
  const { stat } = await import('node:fs/promises')
  const st = await stat(src)
  const key = `${src}:${String(st.mtimeMs)}:${String(st.size)}`
  if (cacheTranscript?.key === key) return cacheTranscript.records
  const records = Object.freeze(
    loadJsonl<SessionRecord>(src, { tolerateTrailingPartialLine: true }),
  )
  cacheTranscript = { key, records }
  return records
}

export async function readUserTurnPreviewsAsync(
  sessionId: string,
  opts: { cwd?: string; baseDir?: string } = {},
): Promise<string[]> {
  const cwd = opts.cwd ?? process.cwd()
  const dir = opts.baseDir ?? defaultBaseDir()
  const src = transcriptPath(dir, cwd, sessionId)
  const { access } = await import('node:fs/promises')
  try {
    await access(src)
  } catch {
    return []
  }
  return userTurnPreviews(await readTranscriptAsync(src))
}
