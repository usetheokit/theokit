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
  listIncludingArchived,
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

describe('a fork of a registered session', () => {
  it('test_an_old_fork_is_collected_without_removing_its_registered_source', async () => {
    // A fork copies its source's rows, so its first row names the SOURCE session.
    writeTranscript(fx, 'newest', 1)
    const source = writeTranscript(fx, 'source-live', 2)
    const fork = writeTranscript(fx, 'the-fork', 90, {
      content: `${JSON.stringify({ type: 'user', sessionId: 'source-live' })}\n`,
    })
    const removed: string[] = []

    const { plan } = await run(true, {
      listRegistry: async () => [{ agentId: 'source-live' }, { agentId: 'the-fork', archived: true }],
      removeFromRegistry: (id: string) => void removed.push(id),
    })

    expect(plan.candidates.map((c) => c.transcript)).toContain(fork)
    expect(existsSync(fork)).toBe(false)
    expect(existsSync(source)).toBe(true)
    expect(removed, 'the live source session lost its registry entry').not.toContain('source-live')
  })
  it('test_an_old_fork_of_an_archived_protected_source_does_not_remove_the_source', async () => {
    // The source is ARCHIVED (so not in the live registry set) but its transcript is the newest, hence
    // protected by recency. The fork still names it in its first row.
    const source = writeTranscript(fx, 'source-archived', 1)
    const fork = writeTranscript(fx, 'the-fork', 90, {
      content: `${JSON.stringify({ type: 'user', sessionId: 'source-archived' })}\n`,
    })
    const removed: string[] = []

    await run(true, {
      listRegistry: async () => [
        { agentId: 'source-archived', archived: true },
        { agentId: 'the-fork', archived: true },
      ],
      removeFromRegistry: (id: string) => void removed.push(id),
    })

    expect(existsSync(fork)).toBe(false)
    expect(existsSync(source)).toBe(true)
    expect(removed, 'the protected source lost its registry entry').toEqual(['the-fork'])
  })
})

describe('a fork is collected under its own identity', () => {
  const forkOf = (src: string): string => `${JSON.stringify({ type: 'user', sessionId: src })}\n`

  it('test_a_registered_archived_fork_loses_its_own_entry_and_the_source_keeps_its_own', async () => {
    writeTranscript(fx, 'newest', 1)
    const source = writeTranscript(fx, 'source-live', 2)
    const fork = writeTranscript(fx, 'the-fork', 90, { content: forkOf('source-live') })
    const removed: string[] = []

    const { plan, result } = await run(true, {
      listRegistry: async () => [
        { agentId: 'source-live' },
        { agentId: 'the-fork', archived: true },
      ],
      removeFromRegistry: (id: string) => void removed.push(id),
    })

    expect(existsSync(fork)).toBe(false)
    expect(existsSync(source)).toBe(true)
    expect(removed).toEqual(['the-fork'])
    expect(result.removed).toEqual(['the-fork'])
    expect(plan.candidates.map((c) => c.id)).toEqual(['the-fork'])
  })

  it('test_an_old_legacy_transcript_keeps_the_registry_entry_while_the_current_one_is_protected', async () => {
    // The archived session's current transcript is the most recent (protected); its older
    // legacy-named transcript is a candidate under the SAME id. Removing it must not drop the entry.
    const current = writeTranscript(fx, 'arch', 1)
    const legacy = writeTranscript(fx, 'arch', 90, { legacy: true })
    const removed: string[] = []

    await run(true, {
      listRegistry: async () => [{ agentId: 'arch', archived: true }],
      removeFromRegistry: (id: string) => void removed.push(id),
    })

    expect(existsSync(current)).toBe(true)
    expect(existsSync(legacy)).toBe(false)
    expect(removed, 'the entry of a session whose transcript survives was removed').toEqual([])
  })

  it('test_an_unregistered_fork_is_reported_by_path_not_as_its_source', async () => {
    writeTranscript(fx, 'newest', 1)
    writeTranscript(fx, 'source-live', 2)
    const fork = writeTranscript(fx, 'the-fork', 90, { content: forkOf('source-live') })
    const removed: string[] = []

    const { plan, result } = await run(true, {
      listRegistry: async () => [{ agentId: 'source-live' }],
      removeFromRegistry: (id: string) => void removed.push(id),
    })

    expect(existsSync(fork)).toBe(false)
    expect(removed).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.orphaned).toEqual([fork])
    expect(humanReport(plan, result).join('\n')).not.toContain('source-live')
  })

  it('test_the_default_listing_asks_for_archived_sessions', async () => {
    let seen: Record<string, unknown> | undefined
    const items = await listIncludingArchived('/p', async (o) => {
      seen = o
      return { items: [{ agentId: 'old-archived', archived: true }] }
    })
    expect(seen).toMatchObject({ includeArchived: true })
    expect(items.map((i) => i.agentId)).toEqual(['old-archived'])
  })

  it('test_a_readable_orphan_absent_from_the_listing_never_reaches_the_registry', async () => {
    // `Agent.delete` has no project constraint: an id from another project must not be removed.
    writeTranscript(fx, 'newest', 1)
    const orphan = writeTranscript(fx, 'orphan-id', 90)
    const removed: string[] = []

    await run(true, {
      listRegistry: async () => [],
      removeFromRegistry: (id: string) => void removed.push(id),
    })

    expect(existsSync(orphan)).toBe(false)
    expect(removed).toEqual([])
  })

  it('test_a_legacy_name_shared_by_two_registered_ids_is_withheld_not_guessed', async () => {
    writeTranscript(fx, 'newest', 1)
    // `a.b` and `a-b` are filed under the same legacy name; the fork names `a.b` as its source.
    const shared = writeTranscript(fx, 'a-b', 90, { legacy: true, content: forkOf('a.b') })
    const removed: string[] = []

    const { plan, result } = await run(true, {
      listRegistry: async () => [
        { agentId: 'a.b', archived: true },
        { agentId: 'a-b', archived: true },
      ],
      removeFromRegistry: (id: string) => void removed.push(id),
    })

    expect(existsSync(shared)).toBe(true)
    expect(removed).toEqual([])
    expect(plan.candidates).toEqual([])
    expect(result.errors).toEqual([])
  })

  it('test_a_pointer_moving_onto_a_later_legacy_named_candidate_mid_apply_keeps_it', async () => {
    writeTranscript(fx, 'newest', 1)
    writeTranscript(fx, 'trigger', 70)
    const legacy = writeTranscript(fx, 'late-legacy', 90, { legacy: true })

    await run(true, {
      listRegistry: async () => [{ agentId: 'trigger', archived: true }],
      removeFromRegistry: (id: string) => {
        if (id === 'trigger') writePointer(fx, 'late-legacy')
      },
    })

    expect(existsSync(legacy)).toBe(true)
  })
})

describe('a source that becomes protected between plan and apply', () => {
  // Candidates are processed newest first: `trigger` (70d) runs before `source-old` (80d) and
  // `the-fork` (90d), so what its removal does happens mid-apply, before either is reached.
  async function applyWith(claim: (source: string) => Promise<void> | void): Promise<string[]> {
    writeTranscript(fx, 'newest', 1)
    const source = writeTranscript(fx, 'source-old', 80)
    writeTranscript(fx, 'trigger', 70)
    writeTranscript(fx, 'the-fork', 90, {
      content: `${JSON.stringify({ type: 'user', sessionId: 'source-old' })}\n`,
    })
    const removed: string[] = []
    const listRegistry = async () => [
      { agentId: 'trigger', archived: true },
      { agentId: 'the-fork', archived: true },
    ]
    const dry = await run(false, { listRegistry })
    expect(dry.plan.candidates.map((c) => c.id)).toEqual(['trigger', 'source-old', 'the-fork'])

    await run(true, {
      listRegistry,
      removeFromRegistry: async (id: string) => {
        removed.push(id)
        if (id === 'trigger') await claim(source)
      },
    })
    expect(existsSync(source)).toBe(true)
    expect(existsSync(transcriptPath(fx.root, fx.cwd, 'the-fork'))).toBe(false)
    return removed
  }

  it('test_a_fork_does_not_remove_a_source_the_pointer_claimed_after_planning', async () => {
    const removed = await applyWith(() => writePointer(fx, 'source-old'))
    expect(removed).toEqual(['trigger', 'the-fork'])
  })

  it('test_a_fork_does_not_remove_a_source_leased_after_planning', async () => {
    let lease: unknown
    try {
      const removed = await applyWith(async (source) => {
        lease = await acquireSessionWriter(source)
      })
      expect(removed).toEqual(['trigger', 'the-fork'])
    } finally {
      await (lease as { release?: () => Promise<void> } | undefined)?.release?.()
    }
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
