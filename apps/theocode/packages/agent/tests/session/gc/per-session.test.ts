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
import { planTranscriptGC, runTranscriptGC } from '@theokit/agents/session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  humanReport,
  planAndRunCurrentProjectGC,
  sessionsCommand,
} from '../../../../cli/src/commands/sessions.js'
import { gcProtectedIds } from '../../../src/session/gc/pointer.js'
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

describe('the guards the old runSessionGC pinned, now through the command', () => {
  it('never_deletes_the_session_the_pointer_is_on', async () => {
    writeTranscript(fx, 'newest', 1)
    const pointed = writeTranscript(fx, 'tui-live', 90)
    writePointer(fx, 'tui-live')
    const removed: string[] = []

    await run(true, { removeFromRegistry: (id: string) => void removed.push(id) })

    expect(existsSync(pointed)).toBe(true)
    expect(removed).not.toContain('tui-live')
  })

  it('never_deletes_the_most_recent_transcript_on_disk', async () => {
    // Protected even with no pointer: a fresh session not yet pointed at is what the user resumes.
    const newest = writeTranscript(fx, 'newest', 90)

    const { plan, result } = await run(true, { maxAgeDays: 1 })

    expect(plan.candidates).toEqual([])
    expect(result.removed).toEqual([])
    expect(existsSync(newest)).toBe(true)
  })

  it('still_deletes_an_unprotected_session', async () => {
    writeTranscript(fx, 'newest', 1)
    const old = writeTranscript(fx, 'old', 90)

    const { result } = await run(true)

    expect(result.removed).toEqual(['old'])
    expect(existsSync(old)).toBe(false)
  })

  it('protects_the_pointer_recorded_on_the_plan_itself', async () => {
    // The plan is a snapshot: a pointer written AFTER planning must still stop the apply.
    writeTranscript(fx, 'newest', 1)
    const late = writeTranscript(fx, 'late-live', 90)
    const protectedIds = gcProtectedIds(fx.cwd)
    const plan = planTranscriptGC({
      cwd: fx.cwd,
      root: fx.root,
      now: NOW,
      keepLast: 1,
      maxAgeDays: 30,
      protectedIds,
    })
    expect(plan.candidates.map((c) => c.id)).toEqual(['late-live'])
    writePointer(fx, 'late-live')

    const result = await runTranscriptGC(plan, { apply: true, protectedIds })

    expect(result.removed).toEqual([])
    expect(existsSync(late)).toBe(true)
  })

  it('a_dry_run_deletes_nothing_at_all', async () => {
    writeTranscript(fx, 'newest', 1)
    const old = writeTranscript(fx, 'old', 90)
    const removed: string[] = []

    const { result } = await run(false, { removeFromRegistry: (id: string) => void removed.push(id) })

    expect(result.dryRun).toBe(true)
    expect(removed).toEqual([])
    expect(existsSync(old)).toBe(true)
  })

  it('test_a_legacy_and_a_current_file_of_one_id_are_reported_per_file', async () => {
    writeTranscript(fx, 'newest', 1)
    const current = writeTranscript(fx, 'twin', 90)
    writeTranscript(fx, 'twin', 80, { legacy: true })

    const { plan, result } = await run(true)
    // Both files share one id; the report is judged per file, and both are gone.
    expect(result.errors).toEqual([])
    expect(humanReport(plan, result).join('\n')).not.toMatch(/NOT removed/)
    expect(existsSync(current)).toBe(false)
    expect(plan.candidates).toHaveLength(2)
  })
})

vi.mock('@theocode/agent/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@theocode/agent/session')>()),
  listAgents: async () => [],
}))
vi.mock('@theokit/agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@theokit/agents')>()),
  Agent: { delete: async () => undefined },
}))

describe('theocode sessions gc, through sessionsCommand', () => {
  let out = ''
  let err = ''
  const savedHome = process.env.THEOKIT_HOME

  class Exit extends Error {
    constructor(readonly code: number | undefined) {
      super(`exit ${String(code)}`)
    }
  }

  beforeEach(async () => {
    const { transcriptRoot } = await import('@theokit/agents/persistence')
    process.env.THEOKIT_HOME = fx.root
    fx.root = transcriptRoot()
    out = ''
    err = ''
    vi.spyOn(process, 'cwd').mockReturnValue(fx.cwd)
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => ((out += String(c)), true))
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => ((err += String(c)), true))
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Exit(code)
    }) as never)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    if (savedHome === undefined) delete process.env.THEOKIT_HOME
    else process.env.THEOKIT_HOME = savedHome
  })

  const gc = async (over: Record<string, unknown> = {}): Promise<number | undefined> => {
    try {
      await sessionsCommand({
        mode: 'sessions',
        action: 'gc',
        apply: false,
        allProjects: false,
        json: false,
        ...over,
      } as never)
    } catch (e) {
      if (e instanceof Exit) return e.code
      throw e
    }
    return undefined
  }

  it('test_apply_keeps_the_pointer_the_newest_and_the_leased_and_exits_zero', async () => {
    const newest = writeTranscript(fx, 'newest', 40)
    const pointed = writeTranscript(fx, 'tui-live', 90)
    const leased = writeTranscript(fx, 'leased', 80)
    const doomed = writeTranscript(fx, 'doomed', 70)
    writePointer(fx, 'tui-live')
    const lease = await acquireSessionWriter(leased)
    try {
      const code = await gc({ apply: true, keepLast: 1, maxAgeDays: 1, json: true })

      expect(code).toBe(0)
      expect(existsSync(doomed)).toBe(false)
      for (const live of [newest, pointed, leased]) expect(existsSync(live)).toBe(true)
      expect(JSON.parse(out).removed).toEqual(['doomed'])
    } finally {
      await (lease as { release?: () => Promise<void> }).release?.()
    }
  })

  it('test_a_knob_below_the_floor_prints_the_framework_message_and_exits_one', async () => {
    const old = writeTranscript(fx, 'old', 90)

    expect(await gc({ apply: true, keepLast: 0 })).toBe(1)
    expect(err).toContain('`keepLast` must be at least 1, received 0')
    expect(await gc({ apply: true, maxAgeDays: 0 })).toBe(1)
    expect(err).toContain('`maxAgeDays` must be at least 1, received 0')
    expect(existsSync(old)).toBe(true)
  })

  it('test_an_unreadable_pointer_exits_one_and_deletes_nothing', async () => {
    writeTranscript(fx, 'newest', 1)
    const old = writeTranscript(fx, 'old', 90)
    mkdirSync(`${fx.cwd}/.theokit/tui-session`, { recursive: true })

    expect(await gc({ apply: true })).toBe(1)
    expect(existsSync(old)).toBe(true)
  })
})
