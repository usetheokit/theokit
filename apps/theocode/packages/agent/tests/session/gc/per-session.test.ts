/**
 * B-017 — the session GC refuses to delete a live session, and until now nothing noticed.
 *
 * Measured 2026-08-19 before this file existed: neutralising the `untouchable` guard in
 * `runSessionGC` left 73 test files and 534 tests passing. The guard is reached in production from
 * `theocode sessions --apply` (`packages/cli/src/commands/sessions.ts:52-58`), and deleting a
 * user's live pointer or most-recent transcript is unrecoverable.
 *
 * These tests assert that `delete`/`unlink` are NEVER CALLED for a protected id. Asserting only
 * that an error is reported would pass against a mutant that deletes the session AND complains.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { transcriptPath } from '@theokit/agents/persistence'
import { planTranscriptGC, runTranscriptGC } from '@theokit/agents/session'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { planAndRunCurrentProjectGC } from '../../../../cli/src/commands/sessions.js'
import { gcProtectedIds, pointerPath } from '../../../src/session/gc/pointer.js'

const LIVE = 'live-session'
const OLD = 'old-session'
const DAY = 86_400_000
const NOW = 1_000 * DAY

// The framework planner has no `readdir`/`readPointer` seams and no hand-built plans: transcripts are
// real files under a temp root, the pointer is the real `.theokit/tui-session` file, and the
// registry remover (`Agent.delete`) is the injected `delete`.
let root = ''
let cwd = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theocode-gc-root-'))
  cwd = mkdtempSync(join(tmpdir(), 'theocode-gc-cwd-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

function seed(id: string, ageDays: number): string {
  const path = transcriptPath(root, cwd, id)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ type: 'user', sessionId: id })}\n`)
  const when = new Date(NOW - ageDays * DAY)
  utimesSync(path, when, when)
  return path
}

function point(id: string): void {
  mkdirSync(join(pointerPath(cwd), '..'), { recursive: true })
  writeFileSync(pointerPath(cwd), `${id}\n`)
}

const runSessionGC = (opts: {
  apply: boolean
  registered?: string[]
  delete: (id: string) => void
}) =>
  planAndRunCurrentProjectGC({
    cwd,
    root,
    now: NOW,
    keepLast: 1,
    maxAgeDays: 1,
    apply: opts.apply,
    listRegistry: async () => (opts.registered ?? []).map((agentId) => ({ agentId })),
    removeFromRegistry: opts.delete,
  })

describe('runSessionGC', () => {
  it('never_deletes_the_session_the_pointer_is_on', async () => {
    seed('newest', 1)
    const live = seed(LIVE, 99)
    point(LIVE)
    const del = vi.fn()

    const { plan, result } = await runSessionGC({ apply: true, registered: [], delete: del })

    expect(del).not.toHaveBeenCalled()
    expect(existsSync(live)).toBe(true)
    expect(plan.candidates.map((c) => c.id)).not.toContain(LIVE)
    expect(result.removed).not.toContain(LIVE)
  })

  it('never_deletes_the_most_recent_transcript_on_disk', async () => {
    // The newest transcript is protected even when no pointer names it — a fresh session that has
    // not been pointed at yet is still the one the user is about to resume.
    const live = seed(LIVE, 99)
    seed(OLD, 100)
    const del = vi.fn()

    const { result } = await runSessionGC({ apply: true, delete: del })

    expect(existsSync(live)).toBe(true)
    // The older OLD is an unprotected orphan and is collected; the registry is never asked about LIVE.
    expect(del).not.toHaveBeenCalledWith(LIVE)
    expect(result.removed).not.toContain(LIVE)
    expect(result.removed).toContain(OLD)
  })

  it('still_deletes_an_unprotected_session', async () => {
    // THE CONTROL. A guard that refuses everything would pass both tests above and break the
    // feature; without this, "protected" and "broken" are indistinguishable.
    seed(LIVE, 1)
    point(LIVE)
    const old = seed(OLD, 99)
    const del = vi.fn()

    const { result } = await runSessionGC({ apply: true, registered: [], delete: del })

    // An UNREGISTERED old session is the control: a registered one is protected by design. Its id is
    // not in this project's listing, so the registry (which deletes by id, project-blind) is not asked.
    expect(del).not.toHaveBeenCalled()
    expect(result.removed).toContain(OLD)
    expect(result.errors).toHaveLength(0)
    expect(existsSync(old)).toBe(false)
  })

  it('protects_the_pointer_recorded_on_the_plan_itself', async () => {
    // The plan is a snapshot: a pointer written AFTER planning must still stop the apply.
    seed('newest', 1)
    const late = seed(LIVE, 99)
    const protectedIds = gcProtectedIds(cwd)
    const plan = await planTranscriptGC({
      cwd,
      root,
      now: NOW,
      keepLast: 1,
      maxAgeDays: 1,
      protectedIds,
    })
    expect(plan.candidates.map((c) => c.id)).toEqual([LIVE])
    point(LIVE)

    const result = await runTranscriptGC(plan, { apply: true, protectedIds })

    expect(result.removed).toEqual([])
    expect(existsSync(late)).toBe(true)
  })

  it('a_dry_run_deletes_nothing_at_all', async () => {
    seed('newest', 1)
    const old = seed(OLD, 99)
    const del = vi.fn()

    const { result } = await runSessionGC({ apply: false, registered: [], delete: del })

    expect(result.dryRun).toBe(true)
    expect(del).not.toHaveBeenCalled()
    expect(existsSync(old)).toBe(true)
  })
})
