/**
 * B-003 — a transcript with a live writer is never planned for deletion.
 *
 * `hasLiveWriter` is a REQUIRED field of the plan options and is wired to the SDK's
 * `sessionHasWriter`, a cross-process filesystem lease. It was never called in the plan phase: its
 * only two uses sat inside `backstopRefusal`, behind a guard that returns early for everything that
 * is not a lock. So transcript deletion consulted the lease in neither phase.
 *
 * What protected a live transcript instead was the `ageDays > maxAgeDays` filter — a live writer
 * keeps the file's mtime fresh by appending. That is a real mitigation, and it is why this was rated
 * HIGH rather than BLOCKER; it is also an mtime heuristic standing in for an explicit lease the SDK
 * already provides and the caller already wired.
 *
 * A guard that is declared, wired and never invoked is worse than an absent one: it reads as
 * protection.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { runProjectsGC } from '@theokit/agents/session'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { claimRoot, OWNER, THEOCODE_MARKER } from '../../../src/session/gc/root-ownership.js'
import { planSessionGCAllProjects } from './legacy-plan.js'

const DAY = 86_400_000
const NOW = 1_000 * DAY

/** One project holding one transcript old enough to be collectable. */
function options(overrides: Partial<Parameters<typeof planSessionGCAllProjects>[0]> = {}) {
  return {
    now: () => NOW,
    keepLast: 0,
    maxAgeDays: 30,
    listProjects: () => ['proj'],
    listProject: () => [{ name: 'sess-old.jsonl', isDirectory: false, mtimeMs: NOW - 60 * DAY }],
    classify: () => ({ state: 'DEAD' as const, cwd: '/proj' }),
    listRegistry: async () => [],
    hasLiveWriter: () => false,
    readPointer: () => undefined,
    ...overrides,
  } as Parameters<typeof planSessionGCAllProjects>[0]
}

describe('B-003 — the plan phase consults the writer lease', () => {
  it('test_a_stale_transcript_with_no_live_writer_is_collectable', async () => {
    // Anti-vacuity floor: if nothing were ever planned, the test below would pass for free.
    const plan = await planSessionGCAllProjects(options())

    expect(
      plan.candidates.some((c) => c.target.endsWith('sess-old.jsonl')),
      'the fixture stopped producing a collectable transcript, so the guard test below proves nothing',
    ).toBe(true)
  })

  it('test_a_transcript_with_a_live_writer_is_NOT_planned_for_deletion', async () => {
    const hasLiveWriter = vi.fn(() => true)

    const plan = await planSessionGCAllProjects(options({ hasLiveWriter }))

    expect(
      hasLiveWriter,
      '`hasLiveWriter` is a required option wired to the SDK lease and was never called in the plan ' +
        'phase — transcript deletion consulted the lease in neither phase',
    ).toHaveBeenCalled()
    expect(
      plan.candidates.filter((c) => c.kind === 'transcript'),
      'a transcript being written to right now was planned for deletion. Only its mtime freshness ' +
        'stood between a live session and unlink.',
    ).toEqual([])
  })
})

describe('#1911 — only the SDK’s own temp files are collectable', () => {
  it('test_a_foreign_old_tmp_file_is_not_a_candidate_but_an_sdk_temp_file_is', async () => {
    const old = NOW - 60 * DAY
    const sdkTmp = 'abc.jsonl.1234.0123456789abcdef.tmp'
    const plan = await planSessionGCAllProjects(
      options({
        listProject: () => [
          { name: 'notes.tmp', isDirectory: false, mtimeMs: old },
          { name: sdkTmp, isDirectory: false, mtimeMs: old },
        ],
      }),
    )

    expect(plan.candidates.some((c) => c.target.endsWith(sdkTmp))).toBe(true)
    expect(plan.candidates.some((c) => c.target.endsWith('notes.tmp'))).toBe(false)
  })
})

const scratch: string[] = []
afterEach(() => {
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('transcript collection rules', () => {
  it('test_a_transcript_inside_the_age_window_is_kept_and_one_past_it_is_collected', async () => {
    const plan = await planSessionGCAllProjects(
      options({
        listProject: () => [
          { name: 'sess-fresh.jsonl', isDirectory: false, mtimeMs: NOW - 29 * DAY },
          { name: 'sess-stale.jsonl', isDirectory: false, mtimeMs: NOW - 31 * DAY },
        ],
      }),
    )

    expect(plan.candidates.map((c) => c.target.split('/').pop())).toEqual(['sess-stale.jsonl'])
  })

  it('test_only_the_transcript_with_a_live_writer_is_spared', async () => {
    const plan = await planSessionGCAllProjects(
      options({
        listProject: () => [
          { name: 'sess-live.jsonl', isDirectory: false, mtimeMs: NOW - 60 * DAY },
          { name: 'sess-dead.jsonl', isDirectory: false, mtimeMs: NOW - 61 * DAY },
        ],
        hasLiveWriter: (p: string) => p.endsWith('sess-live.jsonl'),
      }),
    )

    expect(plan.candidates.map((c) => c.target.split('/').pop())).toEqual(['sess-dead.jsonl'])
  })

  it('test_a_foreign_file_and_a_foreign_directory_are_never_candidates', async () => {
    const old = NOW - 60 * DAY
    const plan = await planSessionGCAllProjects(
      options({
        listProject: () => [
          { name: 'README.md', isDirectory: false, mtimeMs: old },
          { name: 'notes.txt', isDirectory: false, mtimeMs: old },
          { name: 'scratch', isDirectory: true, mtimeMs: old },
        ],
      }),
    )

    expect(plan.candidates).toEqual([])
    expect(plan.kept).toContain('proj')
  })

  it('test_a_writer_that_appears_between_plan_and_apply_stops_the_unlink', async () => {
    const base = mkdtempSync(join(tmpdir(), 'theocode-gc-writer-'))
    scratch.push(base)
    mkdirSync(join(base, 'projects'), { recursive: true })
    claimRoot(join(base, 'projects'))
    const plan = await planSessionGCAllProjects({ ...options(), projectsRoot: base })
    expect(plan.candidates).toHaveLength(1)
    const target = plan.candidates[0]?.target as string
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, '{}\n')

    const result = await runProjectsGC(plan.framework, {
      apply: true,
      owner: OWNER,
      existingMarker: THEOCODE_MARKER,
      fs: { readFile: () => '', hasLiveWriter: () => true },
    })

    expect(existsSync(target), 'the transcript was unlinked despite a live writer').toBe(true)
    expect(result.removed).toEqual([])
    expect(result.refused.map((r) => r.reason).join(' ')).toMatch(/live writer/)
  })
})
