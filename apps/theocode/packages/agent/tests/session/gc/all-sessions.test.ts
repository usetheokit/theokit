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
import { describe, expect, it, vi } from 'vitest'

import { planVirtual, targetOf, targets } from './plan-harness.js'

const CWD = '/proj'
// A newer decoy: `keepLast` has a floor of 1 and protects the newest transcript, so the transcript
// under test is the older one.
const decoy = { name: 'sess-new.jsonl', ageDays: 40 }

function plan(
  entries: { name: string; isDirectory?: boolean; ageDays?: number }[],
  hasLiveWriter?: (t: string) => boolean,
) {
  return planVirtual({
    projects: { [CWD]: entries },
    ...(hasLiveWriter === undefined ? {} : { hasLiveWriter }),
  })
}

describe('B-003 — the plan phase consults the writer lease', () => {
  it('test_a_stale_transcript_with_no_live_writer_is_collectable', async () => {
    // Anti-vacuity floor: if nothing were ever planned, the test below would pass for free.
    const p = await plan([decoy, { name: 'sess-old.jsonl', ageDays: 60 }])

    expect(
      targets(p).some((t) => t.endsWith('sess-old.jsonl')),
      'the fixture stopped producing a collectable transcript, so the guard test below proves nothing',
    ).toBe(true)
  })

  it('test_a_transcript_with_a_live_writer_is_NOT_planned_for_deletion', async () => {
    const hasLiveWriter = vi.fn(() => true)

    const p = await plan([decoy, { name: 'sess-old.jsonl', ageDays: 60 }], hasLiveWriter)

    expect(
      hasLiveWriter,
      '`hasLiveWriter` was never consulted in the plan phase — transcript deletion consulted the ' +
        'lease in neither phase',
    ).toHaveBeenCalled()
    expect(
      p.candidates.filter((c) => c.kind === 'transcript'),
      'a transcript being written to right now was planned for deletion. Only its mtime freshness ' +
        'stood between a live session and unlink.',
    ).toEqual([])
  })
})

describe('#1911 — only the SDK’s own temp files are collectable', () => {
  it('test_a_foreign_old_tmp_file_is_not_a_candidate_but_an_sdk_temp_file_is', async () => {
    const sdkTmp = 'abc.jsonl.1234.0123456789abcdef.tmp'
    const p = await plan([
      { name: 'notes.tmp', ageDays: 60 },
      { name: sdkTmp, ageDays: 60 },
    ])

    expect(targets(p)).toContain(targetOf(CWD, sdkTmp))
    expect(targets(p)).not.toContain(targetOf(CWD, 'notes.tmp'))
  })
})
