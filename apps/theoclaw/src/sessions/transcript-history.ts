import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { readSessionMessages, type SessionMessage } from '@theokit/sdk'

/** The id the staged copy is read under; its file name is the one the SDK resolves for it. */
const STAGED_ID = 'staged'

/**
 * Every user and assistant turn of a transcript, in file order, read by `readSessionMessages`.
 *
 * The SDK reader only returns the latest uuid chain of a transcript, stops at a compaction
 * boundary, skips records without a uuid and throws on content it does not expect. A transcript
 * here can have all of those, and the command has always shown every turn. So the turns are
 * staged as one clean chain in a scratch session directory (named so the SDK resolves it,
 * whatever the real file is called) and the SDK reads that: each turn becomes one record with
 * its text as a single text block. A line that is not JSON, a record that is not a user or
 * assistant turn, and content that carries no text are left out.
 */
export async function readFullHistory(options: {
  readonly cwd: string
  readonly transcript: string
}): Promise<SessionMessage[]> {
  const records: string[] = []
  let parent: string | null = null
  for (const line of readFileSync(options.transcript, 'utf8').split('\n')) {
    const turn = turnOf(line)
    if (turn === undefined) continue
    const uuid = `turn-${String(records.length)}`
    records.push(
      JSON.stringify({
        type: turn.role,
        uuid,
        parentUuid: parent,
        sessionId: STAGED_ID,
        timestamp: '1970-01-01T00:00:00.000Z',
        message: { content: [{ type: 'text', text: turn.text }] },
      }),
    )
    parent = uuid
  }
  if (records.length === 0) return []

  const scratch = mkdtempSync(join(tmpdir(), 'theoclaw-history-'))
  try {
    const projectDir = join(scratch, 'projects', basename(dirname(options.transcript)))
    mkdirSync(projectDir, { recursive: true })
    writeFileSync(join(projectDir, `${STAGED_ID}.jsonl`), `${records.join('\n')}\n`)
    return await readSessionMessages({
      sessionId: STAGED_ID,
      cwd: options.cwd,
      sessionDir: scratch,
    })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

function turnOf(line: string): { role: 'user' | 'assistant'; text: string } | undefined {
  let record: { type?: unknown; message?: { content?: unknown } } | null
  try {
    record = JSON.parse(line) as typeof record
  } catch {
    return undefined
  }
  if (record?.type !== 'user' && record?.type !== 'assistant') return undefined
  const text = textOf(record.message?.content)
  return text === '' ? undefined : { role: record.type, text }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block: unknown) => {
      const entry = block as { type?: unknown; text?: unknown } | null
      return entry?.type === 'text' && typeof entry.text === 'string' ? entry.text : ''
    })
    .join('')
}
