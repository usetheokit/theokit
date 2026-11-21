/**
 * #1918 — `sessions gc` collects a fork under its OWN identity (split from sessions-gc-protection).
 *
 * A fork copies its source's rows, so its first row names the source. Registry removal must follow
 * the candidate's own id and must never remove a protected (pointer, most recent, leased) source.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transcriptPath } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { planAndRunCurrentProjectGC } from '../../../../cli/src/commands/sessions.js'

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

/** Write a transcript for `sessionId`, `ageDays` old. */
function writeTranscript(
  fx: Fixture,
  sessionId: string,
  ageDays: number,
  opts: { content?: string } = {},
): string {
  const path = transcriptPath(fx.root, fx.cwd, sessionId)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, opts.content ?? `${JSON.stringify({ type: 'user', sessionId })}\n`, 'utf8')
  const when = new Date(NOW - ageDays * DAY)
  utimesSync(path, when, when)
  return path
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

describe('registry identity of a candidate', () => {
  it('test_an_unregistered_fork_naming_a_registered_source_gets_no_registry_identity', async () => {
    writeTranscript(fx, 'newest', 1)
    const source = writeTranscript(fx, 'source-live', 2)
    const fork = writeTranscript(fx, 'the-fork', 90, {
      content: `${JSON.stringify({ type: 'user', sessionId: 'source-live' })}\n`,
    })
    const removed: string[] = []

    const { plan } = await run(true, {
      listRegistry: async () => [{ agentId: 'source-live' }],
      removeFromRegistry: (id: string) => void removed.push(id),
    })

    expect(plan.candidates.find((c) => c.transcript === fork)?.id).toBeUndefined()
    expect(existsSync(fork)).toBe(false)
    expect(existsSync(source)).toBe(true)
    expect(removed).toEqual([])
  })

  it('test_an_unrelated_framework_id_is_kept_on_its_candidate', async () => {
    writeTranscript(fx, 'newest', 1)
    const old = writeTranscript(fx, 'stray', 90)

    const { plan } = await run(false, { listRegistry: async () => [{ agentId: 'other' }] })

    expect(plan.candidates.find((c) => c.transcript === old)?.id).toBe('stray')
  })
})
