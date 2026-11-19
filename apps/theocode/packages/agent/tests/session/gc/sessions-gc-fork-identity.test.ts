/**
 * #1918 — `sessions gc` collects a fork under its OWN identity (split from sessions-gc-protection).
 *
 * A fork copies its source's rows, so its first row names the source. Registry removal must follow
 * the candidate's own id and must never remove a protected (pointer, most recent, leased) source.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { legacyTranscriptPath, transcriptPath } from '@theokit/agents/persistence'
import { acquireSessionWriter } from '@theokit/sdk/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  humanReport,
  listIncludingArchived,
  planAndRunCurrentProjectGC,
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
      listRegistry: async () => [
        { agentId: 'source-live' },
        { agentId: 'the-fork', archived: true },
      ],
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

describe('a registered archived source protected by a lease or recency', () => {
  const forkOf = (src: string): string => `${JSON.stringify({ type: 'user', sessionId: src })}\n`

  it('test_an_old_fork_never_removes_a_leased_archived_source_or_the_most_recent_one', async () => {
    const recent = writeTranscript(fx, 'source-recent', 1)
    const leased = writeTranscript(fx, 'source-leased', 50)
    const fork = writeTranscript(fx, 'the-fork', 90, { content: forkOf('source-leased') })
    const removed: string[] = []
    let lease: unknown
    try {
      lease = await acquireSessionWriter(leased)
      await run(true, {
        listRegistry: async () => [
          { agentId: 'source-recent', archived: true },
          { agentId: 'source-leased', archived: true },
          { agentId: 'the-fork', archived: true },
        ],
        removeFromRegistry: (id: string) => void removed.push(id),
      })
    } finally {
      await (lease as { release?: () => Promise<void> } | undefined)?.release?.()
    }

    expect(existsSync(fork)).toBe(false)
    expect(existsSync(recent)).toBe(true)
    expect(existsSync(leased)).toBe(true)
    expect(removed).toEqual(['the-fork'])
  })
})
