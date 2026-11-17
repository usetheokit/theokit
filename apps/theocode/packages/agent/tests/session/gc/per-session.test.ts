/**
 * B-017 / #1918 — `theocode sessions gc` never plans or removes a live session.
 *
 * Runs the command's own function (`planAndRunCurrentProjectGC`) over real transcripts: the session
 * the TUI pointer names, the most recent one and one with a writer lease are never candidates, and
 * `--apply` deletes none of them. Asserting only that an error is reported would pass against a
 * mutant that deletes the session AND complains, so the files are checked on disk.
 */
import { existsSync, mkdirSync } from 'node:fs'

import { acquireSessionWriter } from '@theokit/sdk/persistence'
import { describe, expect, it } from 'vitest'

import { humanReport, planAndRunCurrentProjectGC } from '../../../../cli/src/commands/sessions.js'
import { NOW, useFixture, writePointer, writeTranscript } from './gc-command-fixture.js'

const fx = useFixture()
const run = (apply: boolean, extra: Record<string, unknown> = {}) =>
  planAndRunCurrentProjectGC({
    cwd: fx.cwd,
    root: fx.root,
    now: NOW,
    keepLast: 1,
    maxAgeDays: 30,
    apply,
    listRegistry: async () => [],
    removeFromRegistry: () => undefined,
    ...extra,
  })

describe('sessions gc never touches a live session', () => {
  it('test_the_pointer_the_most_recent_and_a_leased_session_are_never_planned_or_removed', async () => {
    const newest = writeTranscript(fx, 'newest', 40)
    const pointed = writeTranscript(fx, 'tui-live', 90)
    const leased = writeTranscript(fx, 'leased', 80)
    const doomed = writeTranscript(fx, 'doomed', 70)
    writePointer(fx, 'tui-live')
    const lease = await acquireSessionWriter(leased)
    try {
      const dry = await run(false)
      expect(dry.plan.candidates.map((c) => c.id)).toEqual(['doomed'])

      const applied = await run(true)
      expect(applied.result.removed).toEqual(['doomed'])
      expect(existsSync(doomed)).toBe(false)
      for (const live of [newest, pointed, leased]) expect(existsSync(live)).toBe(true)
    } finally {
      await (lease as { release?: () => Promise<void> }).release?.()
    }
  })

  it('test_an_unreadable_pointer_refuses_the_run_and_deletes_nothing', async () => {
    const old = writeTranscript(fx, 'old', 90)
    writeTranscript(fx, 'newest', 40)
    // The pointer path is a directory: reading it fails with EISDIR, not ENOENT.
    mkdirSync(`${fx.cwd}/.theokit/tui-session`, { recursive: true })

    await expect(run(true)).rejects.toThrow(/refus/i)
    expect(existsSync(old)).toBe(true)
  })
})

describe('the report', () => {
  it('test_an_applied_run_does_not_claim_a_failed_removal', async () => {
    writeTranscript(fx, 'newest', 40)
    writeTranscript(fx, 'registered-old', 90)
    writeTranscript(fx, 'plain-old', 80)
    const { plan, result } = await run(true, {
      removeFromRegistry: (id: string) => {
        if (id === 'registered-old') throw new Error('registry down')
      },
    })

    const lines = humanReport(plan, result).join('\n')
    expect(lines).toMatch(/plain-old.*\[removed\]/)
    expect(lines).toMatch(/registered-old.*NOT removed/)
    expect(lines).toMatch(/registered-old: registry removal failed/)
  })

  it('test_a_dry_run_says_would_remove', async () => {
    writeTranscript(fx, 'newest', 40)
    writeTranscript(fx, 'old', 90)
    const { plan, result } = await run(false)
    const lines = humanReport(plan, result)
    expect(lines[0]).toMatch(/DRY-RUN — 1 would remove/)
    expect(lines.join('\n')).toContain('--apply')
  })
})
