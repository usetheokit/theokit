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
import { describe, expect, it, vi } from 'vitest'

import { runSessionGC, type SessionGCPlan } from '../../../src/session/gc/per-session.js'

const LIVE = 'live-session'
const OLD = 'old-session'

function planWith(
  candidates: SessionGCPlan['candidates'],
  extra: Partial<SessionGCPlan> = {},
): SessionGCPlan {
  return { candidates, kept: [], total: candidates.length, ...extra }
}

/** No real filesystem: `readdir` and `readPointer` are the seams the module already declares. */
function seams(pointer: string | undefined, onDisk: { id: string; mtimeMs: number }[] = []) {
  return {
    apply: true,
    cwd: '/nowhere',
    baseDir: '/nowhere',
    readPointer: () => pointer,
    readdir: () => onDisk,
  }
}

describe('runSessionGC', () => {
  it('never_deletes_the_session_the_pointer_is_on', async () => {
    const del = vi.fn(async () => {})
    const unlink = vi.fn(async () => {})

    const result = await runSessionGC(planWith([{ id: LIVE, ageDays: 99, inRegistry: true }]), {
      ...seams(LIVE),
      delete: del,
      unlink,
    })

    expect(del).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
    expect(result.removed).not.toContain(LIVE)
    expect(result.errors.join(' ')).toContain(LIVE)
  })

  it('never_deletes_the_most_recent_transcript_on_disk', async () => {
    // The newest transcript is protected even when no pointer names it — a fresh session that has
    // not been pointed at yet is still the one the user is about to resume.
    const del = vi.fn(async () => {})
    const unlink = vi.fn(async () => {})

    const result = await runSessionGC(planWith([{ id: LIVE, ageDays: 99, inRegistry: false }]), {
      ...seams(undefined, [
        { id: LIVE, mtimeMs: 2 },
        { id: OLD, mtimeMs: 1 },
      ]),
      delete: del,
      unlink,
    })

    expect(unlink).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    expect(result.removed).not.toContain(LIVE)
  })

  it('still_deletes_an_unprotected_session', async () => {
    // THE CONTROL. A guard that refuses everything would pass both tests above and break the
    // feature; without this, "protected" and "broken" are indistinguishable.
    const del = vi.fn(async () => {})
    const unlink = vi.fn(async () => {})

    const result = await runSessionGC(planWith([{ id: OLD, ageDays: 99, inRegistry: true }]), {
      ...seams(LIVE, [{ id: LIVE, mtimeMs: 2 }]),
      delete: del,
      unlink,
    })

    expect(del).toHaveBeenCalledWith(OLD)
    expect(result.removed).toContain(OLD)
    expect(result.errors).toHaveLength(0)
  })

  it('protects_the_pointer_recorded_on_the_plan_itself', async () => {
    // `untouchable` is the union of four sources; the plan's own `pointer` is one the live seams
    // cannot supply, so a mutant that consulted only the live pointer would survive without this.
    const del = vi.fn(async () => {})

    const result = await runSessionGC(
      planWith([{ id: LIVE, ageDays: 99, inRegistry: true }], { pointer: LIVE }),
      { ...seams(undefined), delete: del, unlink: vi.fn(async () => {}) },
    )

    expect(del).not.toHaveBeenCalled()
    expect(result.removed).not.toContain(LIVE)
  })

  it('a_dry_run_deletes_nothing_at_all', async () => {
    const del = vi.fn(async () => {})
    const unlink = vi.fn(async () => {})

    const result = await runSessionGC(planWith([{ id: OLD, ageDays: 99, inRegistry: true }]), {
      delete: del,
      unlink,
    })

    expect(result.dryRun).toBe(true)
    expect(del).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
  })
})
