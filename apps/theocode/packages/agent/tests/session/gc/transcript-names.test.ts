/**
 * The naming vocabulary the plan and apply phases share.
 *
 * B-020's argument for one definition: both phases strip these suffixes, and a divergence between
 * them would let the apply phase delete a lock whose transcript the plan phase believed was still
 * on disk. The vocabulary now lives in the framework; these tests pin it through the planner.
 */
import { describe, expect, it } from 'vitest'

import { planSessionGCAllProjects } from './legacy-plan.js'

const DAY = 86_400_000
const NOW = 1_000 * DAY

async function plan(names: string[]) {
  return planSessionGCAllProjects({
    now: () => NOW,
    keepLast: 0,
    maxAgeDays: 30,
    listProjects: () => ['proj'],
    listProject: () =>
      // `<id>.jsonl.lock` is the directory shape of the lock, `<id>.jsonl.writer.lock` the file one.
      names.map((name) => ({
        name,
        isDirectory: name.endsWith('.jsonl.lock'),
        mtimeMs: NOW - 90 * DAY,
      })),
    classify: () => ({ state: 'DEAD', cwd: '/proj' }),
    listRegistry: async () => [],
    hasLiveWriter: () => false,
    readPointer: () => undefined,
  } as never)
}

const base = (p: { candidates: { target: string }[] }): string[] =>
  p.candidates.map((c) => c.target.split('/').pop() ?? '')

describe('transcript names', () => {
  it('transcriptId_strips_exactly_the_jsonl_suffix', async () => {
    // The lock of `80a43d49-abc` is judged against `80a43d49-abc.jsonl` and nothing else.
    const withSibling = await plan(['80a43d49-abc.jsonl.lock', '80a43d49-abc.jsonl'])
    const other = await plan(['80a43d49-abc.jsonl.lock', '80a43d49-abc.txt'])

    expect(base(withSibling)).not.toContain('80a43d49-abc.jsonl.lock')
    expect(base(other)).toContain('80a43d49-abc.jsonl.lock')
  })

  it('lockId_maps_both_lock_shapes_to_the_transcript_they_guard', async () => {
    const guarded = await plan([
      '80a43d49-abc.jsonl',
      '80a43d49-abc.jsonl.lock',
      '80a43d49-abc.jsonl.writer.lock',
    ])
    const orphans = await plan(['80a43d49-abc.jsonl.lock', '80a43d49-abc.jsonl.writer.lock'])

    expect(base(guarded)).not.toContain('80a43d49-abc.jsonl.lock')
    expect(base(guarded)).not.toContain('80a43d49-abc.jsonl.writer.lock')
    expect(base(orphans).sort()).toEqual([
      '80a43d49-abc.jsonl.lock',
      '80a43d49-abc.jsonl.writer.lock',
    ])
  })

  it('lock_suffix_and_lockId_agree_on_what_is_a_lock', async () => {
    // A name that is not a lock is never collected as one, however stale.
    const result = await plan(['a.jsonl.writer.lock', 'a.jsonl.lock', 'a.jsonl.locked', 'a.lock'])

    expect(base(result).sort()).toEqual(['a.jsonl.lock', 'a.jsonl.writer.lock'])
  })

  it('a.jsonl', async () => {
    // A bare transcript name is a transcript, never a lock: it is reported as the former.
    const plain = await plan(['a.jsonl'])

    expect(plain.candidates.map((c) => c.kind)).toEqual(['transcript'])
  })
})
