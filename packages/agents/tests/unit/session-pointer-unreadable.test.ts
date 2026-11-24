import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import type * as Fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transcriptPath } from '@theokit/sdk/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * #2896 — a `last-session` pointer that exists but cannot be read (EACCES) must refuse, on every
 * path that deletes or overwrites. `readFileSync` is made to throw for the pointer path only, so
 * transcript discovery keeps working.
 */
const state = vi.hoisted(() => ({ failing: undefined as string | undefined }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>()
  return {
    ...actual,
    readFileSync: ((path: unknown, ...rest: unknown[]) => {
      if (typeof path === 'string' && path === state.failing) {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(path, ...rest)
    }) as typeof actual.readFileSync,
  }
})

import {
  SessionPointerUnreadableError,
  deleteSession,
  forkBeforeUserTurn,
  protectedTranscriptPaths,
} from '../../src/session/session-lifecycle.js'
import { planTranscriptGC, runTranscriptGC } from '../../src/session/gc/transcript-gc.js'
import { persistSessionId, sessionPointerPath } from '../../src/session/session-pointer.js'

const CWD = '/some/project'
const NOW = 1_700_000_000_000
let root: string

function write(id: string, ageDays: number): string {
  const path = transcriptPath(root, CWD, id)
  mkdirSync(join(path, '..'), { recursive: true })
  const user = JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    uuid: `u-${id}`,
    parentUuid: null,
    sessionId: id,
    timestamp: '2026-08-14T00:00:00.000Z',
  })
  writeFileSync(path, `${user}\n`, 'utf8')
  const t = (NOW - ageDays * 86_400_000) / 1000
  utimesSync(path, t, t)
  return path
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'pointer-eacces-'))
  state.failing = undefined
})
afterEach(() => {
  state.failing = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('an EACCES on the last-session pointer refuses (#2896)', () => {
  async function setup() {
    const older = write('older', 50)
    write('newer', 1)
    await persistSessionId(CWD, 'older', root)
    state.failing = sessionPointerPath(CWD, root)
    return older
  }

  it('deleteSession rejects and keeps the older transcript', async () => {
    const older = await setup()
    await expect(deleteSession('older', { cwd: CWD, root })).rejects.toBeInstanceOf(
      SessionPointerUnreadableError,
    )
    expect(existsSync(older)).toBe(true)
  })

  it('forkBeforeUserTurn rejects and writes no fork', async () => {
    await setup()
    await expect(forkBeforeUserTurn('older', 'fork', 1, { cwd: CWD, root })).rejects.toBeInstanceOf(
      SessionPointerUnreadableError,
    )
    expect(existsSync(transcriptPath(root, CWD, 'fork'))).toBe(false)
  })

  it('planTranscriptGC rejects', async () => {
    await setup()
    await expect(
      planTranscriptGC({ cwd: CWD, root, now: NOW, keepLast: 1, maxAgeDays: 1 }),
    ).rejects.toBeInstanceOf(SessionPointerUnreadableError)
  })

  it('runTranscriptGC refuses when the pointer becomes unreadable after planning', async () => {
    const older = write('older', 50)
    write('newer', 1)
    const plan = await planTranscriptGC({ cwd: CWD, root, now: NOW, keepLast: 1, maxAgeDays: 1 })
    expect(plan.candidates.map((c) => c.id)).toEqual(['older'])
    await persistSessionId(CWD, 'older', root)
    state.failing = sessionPointerPath(CWD, root)
    await expect(runTranscriptGC(plan, { apply: true })).rejects.toBeInstanceOf(
      SessionPointerUnreadableError,
    )
    expect(existsSync(older)).toBe(true)
  })

  it('a missing pointer is still no pointer', async () => {
    write('older', 50)
    write('newer', 1)
    const got = await protectedTranscriptPaths(CWD, root)
    expect([...got.values()]).toEqual(['most recent session'])
  })
})
