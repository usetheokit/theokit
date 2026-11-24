/**
 * B-003 — the live-session pointer is read one way, and unreadable means refuse.
 *
 * The reader is the framework's (`protectedTranscriptPaths`); TheoCode no longer has its own. The
 * GC and the delete guard use its answer as a deletion decision, so an unreadable file must refuse.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { transcriptPath } from '@theokit/agents/persistence'
import { protectedTranscriptPaths, sessionPointerPath } from '@theokit/agents/session'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const cwd = '/p'
let root: string

function transcript(id: string, ageSeconds: number): string {
  const path = transcriptPath(root, cwd, id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ type: 'user', sessionId: id })}\n`)
  const t = Date.now() / 1000 - ageSeconds
  utimesSync(path, t, t)
  return path
}

function setPointer(content: string): void {
  const file = sessionPointerPath(cwd, root)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theocode-pointer-'))
  transcript('older', 5000)
  transcript('newer', 1)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const reasons = async () => [...(await protectedTranscriptPaths(cwd, root)).values()]

describe('B-003 — reading the live-session pointer', () => {
  it('test_a_missing_pointer_means_no_live_session', async () => {
    expect(await reasons()).toEqual(['most recent session'])
  })

  it('test_an_unreadable_pointer_REFUSES_instead_of_reporting_no_session', async () => {
    mkdirSync(sessionPointerPath(cwd, root), { recursive: true }) // EISDIR, not ENOENT
    await expect(protectedTranscriptPaths(cwd, root)).rejects.toThrow(/last-session pointer/)
  })

  it('test_an_empty_pointer_means_no_live_session', async () => {
    setPointer('  \n')
    expect(await reasons()).toEqual(['most recent session'])
  })

  it('test_a_written_pointer_protects_its_session', async () => {
    setPointer('older\n')
    const got = await protectedTranscriptPaths(cwd, root)
    expect(got.get(transcriptPath(root, cwd, 'older'))).toBe('resumable session pointer')
  })
})
