/**
 * #1918 — `theocode sessions gc` runs the framework's `planTranscriptGC` / `runTranscriptGC`.
 *
 * Runs the command's own function (`planAndRunCurrentProjectGC`) and `sessionsCommand` over real
 * transcripts: the session the TUI pointer names, the most recent one and one with a writer lease
 * are never candidates and `--apply` deletes none of them; a `keepLast` or `maxAgeDays` below the
 * floor fails with the framework's `GCFloorError` message. Files are checked on disk, because
 * asserting only that an error is reported would pass against a mutant that deletes the session AND
 * complains.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { legacyTranscriptPath, transcriptPath } from '@theokit/agents/persistence'
import { GCFloorError } from '@theokit/agents/session'
import { acquireSessionWriter } from '@theokit/sdk/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  humanReport,
  planAndRunCurrentProjectGC,
  sessionsCommand,
} from '../../../../cli/src/commands/sessions.js'
import { pointerPath } from '../../../src/session/gc/pointer.js'

const DAY = 86_400_000
const NOW = new Date('2026-08-13T12:00:00Z').getTime()

interface Fixture {
  root: string
  cwd: string
}

function withFixture(): Fixture {
  const fx: Fixture = { root: '', cwd: '' }
  beforeEach(() => {
    fx.root = mkdtempSync(join(tmpdir(), 'theocode-gc-root-'))
    fx.cwd = mkdtempSync(join(tmpdir(), 'theocode-gc-cwd-'))
  })
  afterEach(() => {
    rmSync(fx.root, { recursive: true, force: true })
    rmSync(fx.cwd, { recursive: true, force: true })
  })
  return fx
}

/** Write a transcript for `sessionId`, `ageDays` old. `legacy` uses the 4.x name (the id itself). */
function writeTranscript(
  fx: Fixture,
  sessionId: string,
  ageDays: number,
  opts: { legacy?: boolean; content?: string } = {},
): string {
  const path = (opts.legacy === true ? legacyTranscriptPath : transcriptPath)(
    fx.root,
    fx.cwd,
    sessionId,
  )
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, opts.content ?? `${JSON.stringify({ type: 'user', sessionId })}\n`, 'utf8')
  const when = new Date(NOW - ageDays * DAY)
  utimesSync(path, when, when)
  return path
}

function writePointer(fx: Fixture, sessionId: string): void {
  mkdirSync(join(pointerPath(fx.cwd), '..'), { recursive: true })
  writeFileSync(pointerPath(fx.cwd), `${sessionId}\n`)
}

const fx = withFixture()
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
      listRegistry: async () => [{ agentId: 'registered-old', archived: true }],
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

describe('sessions gc floors and legacy names', () => {
  it('test_a_knob_below_the_floor_fails_with_the_frameworks_GCFloorError_message', async () => {
    const old = writeTranscript(fx, 'old', 90)

    await expect(run(true, { keepLast: 0 })).rejects.toThrow(GCFloorError)
    await expect(run(true, { keepLast: 0 })).rejects.toThrow(
      '`keepLast` must be at least 1, received 0',
    )
    await expect(run(true, { maxAgeDays: 0 })).rejects.toThrow(
      '`maxAgeDays` must be at least 1, received 0',
    )
    expect(existsSync(old)).toBe(true)
  })

  it('test_both_naming_conventions_of_the_tui_pointer_session_are_protected', async () => {
    writeTranscript(fx, 'decoy-newer', 1)
    const current = writeTranscript(fx, 'tui-live', 90)
    const legacy = writeTranscript(fx, 'tui-live', 90, { legacy: true })
    writePointer(fx, 'tui-live')

    await run(true, { maxAgeDays: 1 })

    expect(existsSync(current)).toBe(true)
    expect(existsSync(legacy), 'the legacy transcript of the pointed session was deleted').toBe(
      true,
    )
  })

  it('test_a_legacy_name_the_sdk_sanitises_is_still_protected', async () => {
    // `a.b` is filed as `a-b.jsonl` on 4.x: a stem comparison with the raw id would miss it.
    const id = 'tui.live.1'
    writeTranscript(fx, 'decoy-newer', 1)
    const legacy = writeTranscript(fx, id, 90, { legacy: true })
    writePointer(fx, id)

    await run(true, { maxAgeDays: 1 })

    expect(existsSync(legacy), 'the sanitised legacy name of the pointed session was deleted').toBe(
      true,
    )
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
  Agent: { delete: async () => undefined, list: async () => ({ items: [] }) },
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
    process.exitCode = undefined
  })
  afterEach(() => {
    vi.restoreAllMocks()
    process.exitCode = undefined
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
    // The command ends through `exitAfterDrain`, which sets the exit code rather than exiting.
    const code = process.exitCode
    return typeof code === 'number' ? code : undefined
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
