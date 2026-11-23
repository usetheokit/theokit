/**
 * T4.2 — the GC's pointer protection must be reachable by a consumer whose live sessions it cannot see.
 *
 * `protectedTranscriptPaths` derives protection from THIS framework's pointer convention. For a consumer
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

import { legacyTranscriptPath, transcriptPath } from '../../src/persistence-entry.js'
import { runTranscriptGC, planTranscriptGC } from '../../src/session/gc/transcript-gc.js'

let root: string
let cwd: string

const DAY = 86_400_000
const NOW = 1_800_000_000_000

/** A transcript old enough to be collectable, so protection is the only thing that can save it. */
function writeOldSession(id: string, ageDays: number): void {
  const path = transcriptPath(root, cwd, id)
  mkdirSync(dirname(path), { recursive: true })
  // `sessionId`, not just `uuid`: SDK 5.x names the FILE with a one-way hash of the id, so the
  // record is where the id survives and where a listing reads it (usetheokit/theokit#654).
  writeFileSync(path, `${JSON.stringify({ type: 'user', uuid: id, sessionId: id })}\n`, 'utf8')
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

    const plan = await planTranscriptGC({ cwd, root, keepLast: 1, maxAgeDays: 30, now: NOW })

    // Regression guard: no injection ⇒ byte-identical to before the seam existed.
    expect(plan.candidates.length).toBeGreaterThan(0)
  })

  it('injected_ids_are_added_not_substituted', async () => {
    writeOldSession('old-1', 90)
    writeOldSession('old-2', 90)

    const plan = await planTranscriptGC({
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

    const withoutInjection = await planTranscriptGC({
      cwd,
      root,
      keepLast: 1,
      maxAgeDays: 30,
      now: NOW,
    })
    const withEmptyInjection = await planTranscriptGC({
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

    // Planning is async because the SDK listing it reads is; the injected provider still throws
    // synchronously inside it, so the plan rejects.
    await expect(
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
    ).rejects.toThrow(/registry unavailable|refus/i)
  })

  it('plan_then_delete_concurrent_test_rechecks_injected_ids', async () => {
    // Happens-before observation across the TOCTOU window: the candidate becomes live BETWEEN plan
    // and apply. The existing re-check covered only built-in protection; an injected id that turned
    // live after planning would have been deleted anyway.
    writeOldSession('old-1', 90)
    writeOldSession('old-2', 90)

    const plan = await planTranscriptGC({ cwd, root, keepLast: 1, maxAgeDays: 30, now: NOW })
    const target = plan.candidates[0]
    expect(target, 'fixture produced no candidate').toBeDefined()
    // These fixtures are readable, so the id is present; asserting it keeps the `!` below honest
    // now that `GCCandidate.id` admits absence (usetheokit/theokit#668).
    expect(target?.id, 'a readable fixture must carry its id').toBeDefined()

    const result = await runTranscriptGC(plan, {
      apply: true,
      protectedIds: () => new Map([[target!.id!, 'became live between plan and apply']]),
    })

    expect(result.removed).not.toContain(target!.id)
    expect(existsSync(transcriptPath(root, cwd, target!.id!))).toBe(true)
  })

  it('throwing_provider_fails_closed_on_apply', async () => {
    writeOldSession('old-1', 90)
    const plan = await planTranscriptGC({ cwd, root, keepLast: 1, maxAgeDays: 30, now: NOW })

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

describe('protection by the real file (theokit#2746)', () => {
  const legacyOf = (id: string): string => legacyTranscriptPath(root, cwd, id)

  function writeAt(path: string, sessionId: string, ageDays: number): string {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({ type: 'user', sessionId })}\n`, 'utf8')
    const stamp = new Date(NOW - ageDays * DAY)
    utimesSync(path, stamp, stamp)
    return path
  }
  const opts = () => ({ cwd, root, keepLast: 1, maxAgeDays: 30, now: NOW })

  it('keeps a legacy-named and a forked transcript of protected ids, without a post-filter', async () => {
    writeOldSession('newest', 1)
    const legacy = writeAt(legacyOf('live-a'), 'live-a', 90)
    const fork = writeAt(join(dirname(legacy), 'fork-file.jsonl'), 'live-a', 90)
    const plan = await planTranscriptGC({
      ...opts(),
      protectedIds: () => new Map([['live-a', 'registered']]),
      knownIds: () => ['live-a', 'the-fork'],
    })
    expect(plan.candidates.map((c) => c.transcript)).toEqual([fork])
    // the unowned fork carries no identity, so it can never be taken for its source
    expect(plan.candidates[0]?.id).toBeUndefined()
    await runTranscriptGC(plan, {
      apply: true,
      protectedIds: () => new Map([['live-a', 'registered']]),
    })
    expect(existsSync(legacy)).toBe(true)
    expect(existsSync(fork)).toBe(false)
  })

  it('names a fork by the known id whose file it is, and asks the predicate about that id', async () => {
    writeOldSession('newest', 1)
    const fork = writeAt(transcriptPath(root, cwd, 'the-fork'), 'source', 90)
    const seen: (string | undefined)[] = []
    const plan = await planTranscriptGC({
      ...opts(),
      knownIds: () => ['source', 'the-fork'],
      isProtected: (s) => (seen.push(s.id), s.id === 'source' ? 'held' : undefined),
    })
    expect(plan.candidates.map((c) => [c.id, c.transcript])).toEqual([['the-fork', fork]])
    expect(seen).toContain('the-fork')
  })

  it('a predicate that starts protecting after planning stops the removal; one that throws refuses', async () => {
    writeOldSession('newest', 1)
    const old = writeAt(transcriptPath(root, cwd, 'old'), 'old', 90)
    const plan = await planTranscriptGC(opts())
    expect(plan.candidates).toHaveLength(1)
    await runTranscriptGC(plan, { apply: true, isProtected: () => 'became live' })
    expect(existsSync(old)).toBe(true)
    await expect(
      runTranscriptGC(plan, {
        apply: true,
        isProtected: () => {
          throw new Error('boom')
        },
      }),
    ).rejects.toThrow(/protection provider threw/)
    await expect(
      planTranscriptGC({
        ...opts(),
        isProtected: () => {
          throw new Error('boom')
        },
      }),
    ).rejects.toThrow(/protection provider threw/)
  })
})
