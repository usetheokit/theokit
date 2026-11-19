import { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { readSessionMessages, type SessionMessage } from '@theokit/sdk'

/**
 * The whole history of a transcript, read by `readSessionMessages`.
 *
 * Two things the SDK reader does not do on its own, and this file makes up for without reading
 * messages itself (every message still comes out of the SDK):
 *
 * - It follows the chain back from the newest record, and a `compact_boundary` record starts a new
 *   chain, so a compacted session would lose everything before its last boundary. The transcript
 *   is cut at each boundary and each cut is read on its own; the results are joined in order.
 * - It throws on a record whose `message.content` is a plain string (a shape older transcripts
 *   have). Such a record is handed to the reader with the string as one text block.
 *
 * The cuts are written to a scratch session directory laid out like the real one, so the reader
 * resolves the same file name from the same session id and cwd. Lines that are not JSON are copied
 * through untouched; the reader skips them.
 */
export async function readFullHistory(options: {
  readonly sessionId: string
  readonly cwd: string
  readonly transcript: string
}): Promise<SessionMessage[]> {
  const lines = readFileSync(options.transcript, 'utf8').split('\n')
  const prepared = lines.map(prepare)
  const cuts = prepared.flatMap((line, index) => (line.boundary ? [index] : []))
  // One cut per boundary (everything before it), then the whole file for the last segment.
  const ends = [...cuts.filter((index) => index > 0), lines.length]

  const scratch = mkdtempSync(join(tmpdir(), 'theoclaw-history-'))
  try {
    const projectDir = join(scratch, 'projects', basename(dirname(options.transcript)))
    mkdirSync(projectDir, { recursive: true })
    const file = join(projectDir, basename(options.transcript))
    const history: SessionMessage[] = []
    for (const end of ends) {
      writeFileSync(
        file,
        `${prepared
          .slice(0, end)
          .map((line) => line.text)
          .join('\n')}\n`,
      )
      history.push(
        ...(await readSessionMessages({
          sessionId: options.sessionId,
          cwd: options.cwd,
          sessionDir: scratch,
        })),
      )
    }
    return history
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

interface PreparedLine {
  readonly text: string
  readonly boundary: boolean
}

function prepare(line: string): PreparedLine {
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return { text: line, boundary: false }
  }
  if (typeof record !== 'object' || record === null) return { text: line, boundary: false }
  const entry = record as { subtype?: unknown; message?: { content?: unknown } }
  const boundary = entry.subtype === 'compact_boundary'
  const content = entry.message?.content
  if (typeof content !== 'string') return { text: line, boundary }
  const fixed = {
    ...entry,
    message: { ...entry.message, content: [{ type: 'text', text: content }] },
  }
  return { text: JSON.stringify(fixed), boundary }
}
