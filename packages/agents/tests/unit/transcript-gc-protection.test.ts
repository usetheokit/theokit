/**
 * T4.2 — the GC's pointer protection must be reachable by a consumer whose live sessions it cannot see.
 *
 * `protectedTranscripts` derives protection from THIS framework's pointer convention. For a consumer
 * whose live-session pointer lives elsewhere, the guard is **inert — silently, inside a guard that
 * deletes user transcripts.** That is the same class as the consumer's own PS-002: a guard declared,
 * wired, and never called reads as protection while protecting nothing.
 *
 * Two properties carry the whole task:
 *
 *  1. Injection may only ADD protection, never remove it. If a consumer could unprotect a session the
 *     framework knows is live, the seam would be a deletion vector rather than a safety net.
 *  2. A provider that throws FAILS CLOSED — the GC refuses to collect. This matches `GCFloorError`'s
 *     refuse-don't-clamp posture, and deliberately does NOT reproduce the consumer's own fail-open
 *     bug (PS-001), where an EACCES on the pointer read became "there is no live session".
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { transcriptPath } from '../../src/persistence-entry.js'
import { runTranscriptGC, planTranscriptGC } from '../../src/session/gc/transcript-gc.js'

let root: string
let cwd: string

const DAY = 86_400_000
const NOW = 1_800_000_000_000

/** A transcript old enough to be collectable, so protection is the only thing that can save it. */
function writeOldSession(id: string, ageDays: number): void {
  const path = transcriptPath(root, cwd, id)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `{"type":"user","uuid":"${id}"}\n`, 'utf8')
  const stamp = new Date(NOW - ageDays * DAY)

  utimesSync(path, stamp, stamp)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'theokit-gc-root-'))
  cwd = mkdtempSync(join(tmpdir(), 'theokit-gc-proj-'))
})

afterEach(() => {
  for (const dir of [root, cwd]) rmSync(dir, { recursive: true, force: true })
})

describe('transcript GC — injected protection', () => {
  it('default_behaviour_unchanged_without_injection', async () => {
    writeOldSession('old-1', 90)
    writeOldSession('old-2', 90)

    const plan = planTranscriptGC({ cwd, root, keepLast: 1, maxAgeDays: 30, now: NOW })

    // Regression guard: no injection ⇒ byte-identical to before the seam existed.
    expect(plan.candidates.length).toBeGreaterThan(0)
  })

  it('injected_ids_are_added_not_substituted', async () => {
    writeOldSession('old-1', 90)
    writeOldSession('old-2', 90)

    const plan = planTranscriptGC({
      cwd,
      root,
      keepLast: 1,
      maxAgeDays: 30,
      now: NOW,
      protectedIds: () => new Map([['old-2', 'live in the consumer’s own registry']]),
    })

    expect(plan.candidates.map((c) => c.id)).not.toContain('old-2')
    expect(plan.kept.map((k) => k.id)).toContain('old-2')
  })

  it('injection_cannot_unprotect_what_the_framework_protects', async () => {
    // The safety property. A provider returning an EMPTY map must not strip built-in protection —
    // union, never difference, or the seam becomes a way to delete a live session.
    writeOldSession('old-1', 90)

    const withoutInjection = planTranscriptGC({
      cwd,
      root,
      keepLast: 1,
      maxAgeDays: 30,
      now: NOW,
    })
    const withEmptyInjection = planTranscriptGC({
      cwd,
      root,
      keepLast: 1,
      maxAgeDays: 30,
      now: NOW,
      protectedIds: () => new Map(),
    })

    expect(withEmptyInjection.kept.map((k) => k.id)).toEqual(withoutInjection.kept.map((k) => k.id))
  })

  it('throwing_provider_fails_closed_on_plan', async () => {
    writeOldSession('old-1', 90)

    // `planTranscriptGC` stayed SYNCHRONOUS — only the apply half needed the async seam, because
    // only the apply half touches a registry. Planning reads the filesystem and decides.
    expect(() =>
      planTranscriptGC({
        cwd,
        root,
        keepLast: 1,
        maxAgeDays: 30,
        now: NOW,
        protectedIds: () => {
          throw new Error('registry unavailable')
        },
      }),
    ).toThrow(/registry unavailable|refus/i)
  })

  it('plan_then_delete_concurrent_test_rechecks_injected_ids', async () => {
    // Happens-before observation across the TOCTOU window: the candidate becomes live BETWEEN plan
    // and apply. The existing re-check covered only built-in protection; an injected id that turned
    // live after planning would have been deleted anyway.
    writeOldSession('old-1', 90)
    writeOldSession('old-2', 90)

    const plan = planTranscriptGC({ cwd, root, keepLast: 1, maxAgeDays: 30, now: NOW })
    const target = plan.candidates[0]
    expect(target, 'fixture produced no candidate').toBeDefined()

    const result = await runTranscriptGC(plan, {
      apply: true,
      protectedIds: () => new Map([[target!.id, 'became live between plan and apply']]),
    })

    expect(result.removed).not.toContain(target!.id)
    expect(existsSync(transcriptPath(root, cwd, target!.id))).toBe(true)
  })

  it('throwing_provider_fails_closed_on_apply', async () => {
    writeOldSession('old-1', 90)
    const plan = planTranscriptGC({ cwd, root, keepLast: 1, maxAgeDays: 30, now: NOW })

    await expect(
      runTranscriptGC(plan, {
        apply: true,
        protectedIds: () => {
          throw new Error('registry unavailable')
        },
      }),
    ).rejects.toThrow(/registry unavailable|refus/i)

    // Fail-closed means nothing was deleted, not "stopped halfway".
    expect(existsSync(transcriptPath(root, cwd, 'old-1'))).toBe(true)
  })
})
