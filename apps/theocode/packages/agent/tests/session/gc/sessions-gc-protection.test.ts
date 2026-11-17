/**
 * #1918 — `theocode sessions gc` plans with the framework's `planTranscriptGC`, and what it hands
 * that planner must keep the TUI pointer's session, the most recent session and a leased session
 * out of the candidates, and must refuse a knob below the floor.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { GCFloorError, planTranscriptGC, runTranscriptGC } from '@theokit/agents/session'
import { acquireSessionWriter, transcriptPath } from '@theokit/sdk/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { gcProtectedIds, pointerPath } from '../../../src/session/gc/pointer.js'

const NOW = new Date('2026-08-13T12:00:00Z').getTime()
let root: string
let cwd: string

function write(sessionId: string, ageDays: number): string {
  const path = transcriptPath(root, cwd, sessionId)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ type: 'user', sessionId })}\n`, 'utf8')
  const when = new Date(NOW - ageDays * 86_400_000)
  utimesSync(path, when, when)
  return path
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theocode-gc-root-'))
  cwd = mkdtempSync(join(tmpdir(), 'theocode-gc-cwd-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

const plan = (keepLast = 1, maxAgeDays = 30) =>
  planTranscriptGC({ cwd, root, now: NOW, keepLast, maxAgeDays, protectedIds: gcProtectedIds(cwd) })

describe('sessions gc protection', () => {
  it('never_plans_the_tui_pointer_the_most_recent_or_a_leased_session', async () => {
    write('newest', 40)
    write('tui-live', 90)
    const leased = write('leased', 80)
    write('doomed', 70)
    mkdirSync(join(pointerPath(cwd), '..'), { recursive: true })
    writeFileSync(pointerPath(cwd), 'tui-live\n')
    const lease = await acquireSessionWriter(leased)
    try {
      const p = plan()
      const ids = p.candidates.map((c) => c.id)
      expect(ids).toEqual(['doomed'])
      const result = await runTranscriptGC(p, { apply: false, protectedIds: gcProtectedIds(cwd) })
      expect(result.removed).toEqual(['doomed'])
    } finally {
      await (lease as { release?: () => Promise<void> }).release?.()
    }
  })

  it('refuses_a_knob_below_the_floor_with_the_framework_message', () => {
    write('a', 90)
    expect(() => plan(0, 30)).toThrow(GCFloorError)
    expect(() => plan(0, 30)).toThrow(/`keepLast` must be at least 1, received 0/)
    expect(() => plan(1, 0)).toThrow(/`maxAgeDays` must be at least 1, received 0/)
  })
})
