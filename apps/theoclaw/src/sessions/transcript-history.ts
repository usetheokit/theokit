import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { readSessionMessages, type SessionMessage } from '@theokit/sdk'

/** The id the staged copy is read under; its file name is the one the SDK resolves for it. */
const STAGED_ID = 'staged'

/**
 * Every turn of a transcript, in file order, read by `readSessionMessages`.
 *
 * The SDK reader only returns the latest uuid chain of a transcript, stops at a compaction
 * boundary, skips records without a uuid and throws on content that is not an array of objects.
 * A transcript here can have all of those, and the command has always shown every turn. So each
 * JSON record is staged as it is, except for its place in the file and the shape of its content:
 * the records are chained in file order, and a string content becomes one text block while
 * content that is not a list of objects becomes empty. The staged copy sits in a scratch session
 * directory under a name the SDK resolves, whatever the real file is called. What a record means
 * (its role, its text, whether it is a turn at all) is decided by the SDK, not here.
 */
export async function readFullHistory(options: {
  readonly cwd: string
  readonly transcript: string
}): Promise<SessionMessage[]> {
  const records: string[] = []
  let parent: string | null = null
  for (const line of readFileSync(options.transcript, 'utf8').split('\n')) {
    const record = parseRecord(line)
    if (record === undefined) continue
    const uuid = `record-${String(records.length)}`
    records.push(JSON.stringify(stage(record, uuid, parent)))
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

type Record_ = Record<string, unknown>

function parseRecord(line: string): Record_ | undefined {
  try {
    const parsed: unknown = JSON.parse(line)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record_)
      : undefined
  } catch {
    return undefined
  }
}

function stage(record: Record_, uuid: string, parentUuid: string | null): Record_ {
  const { message } = record
  const staged: Record_ = {
    ...record,
    uuid,
    parentUuid,
    sessionId: STAGED_ID,
    timestamp: '1970-01-01T00:00:00.000Z',
  }
  if (typeof message === 'object' && message !== null) {
    const { content } = message as Record_
    staged.message = { ...message, content: blocksOf(content) }
  }
  return staged
}

function blocksOf(content: unknown): unknown[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  if (!Array.isArray(content)) return []
  return content.filter((block) => typeof block === 'object' && block !== null)
}
