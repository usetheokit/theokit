/**
 * The two numeric defaults of `planSessionGC` that decide what gets DELETED downstream.
 *
 * `resolvePlanOptions` is a defaults block — idiomatic TS, low branching in substance — but the
 * 2026-09-10 architecture review measured its defaulting paths untested, and which default is in
 * force here is exactly what the sweep deletes. These tests omit `keepLast` / `maxAgeDays` on
 * purpose: they pin 10 and 30, so a silent change to either number is a red test rather than a
 * silently wider (or narrower) deletion window.
 *
 * The seams (`readdir`, `list`, `readPointer`, `now`, dirs) stay injected — the subject is the
 * numeric defaults, not the filesystem.
 */
import { describe, expect, it } from 'vitest'

import { planSessionGC } from '../../../src/session/gc/per-session.js'

const DAY = 86_400_000
const NOW = 1_700_000_000_000

function entriesAgedDays(ages: number[]): { id: string; mtimeMs: number }[] {
  return ages.map((age, i) => ({ id: `t-${String(i).padStart(2, '0')}`, mtimeMs: NOW - age * DAY }))
}

function seams(onDisk: { id: string; mtimeMs: number }[]) {
  return {
    cwd: '/nowhere',
    baseDir: '/nowhere',
    now: () => NOW,
    list: async () => [],
    readPointer: () => undefined,
    readdir: () => onDisk,
  }
}

describe('planSessionGC defaults', () => {
  it('keeps_the_ten_newest_transcripts_when_keepLast_is_not_given', async () => {
    // Twelve transcripts, all far past any age window: only the keep-last quota decides.
    const onDisk = entriesAgedDays([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111])

    const plan = await planSessionGC(seams(onDisk))

    expect(plan.kept).toHaveLength(10)
    expect(plan.candidates.map((c) => c.id).sort()).toEqual(['t-10', 't-11'])
  })

  it('collects_past_thirty_days_and_keeps_younger_when_maxAgeDays_is_not_given', async () => {
    // keepLast pinned to 0 so the age window is the only default under test. The newest transcript
    // is protected as most-recent regardless; the 29-day one sits inside the default window and the
    // 31-day one outside it.
    const onDisk = entriesAgedDays([1, 29, 31])

    const plan = await planSessionGC({ ...seams(onDisk), keepLast: 0 })

    expect(plan.candidates.map((c) => c.id)).toEqual(['t-02'])
    expect(plan.kept).toContain('t-01')
  })
})
