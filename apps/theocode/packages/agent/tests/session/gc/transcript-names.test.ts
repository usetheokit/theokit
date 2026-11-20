/**
 * The naming vocabulary the plan and apply phases share.
 *
 * B-020's argument for one definition: both phases strip these suffixes, and a divergence between
 * them would let the apply phase delete a lock whose transcript the plan phase believed was still
 * on disk. These tests pin the mapping at its single implementation.
 */
import { describe, expect, it } from 'vitest'

import { LOCK_SUFFIX, lockId, transcriptId } from '../../../src/session/gc/transcript-names.js'

describe('transcript names', () => {
  it('transcriptId_strips_exactly_the_jsonl_suffix', () => {
    expect(transcriptId('80a43d49-abc.jsonl')).toBe('80a43d49-abc')
  })

  it('lockId_maps_both_lock_shapes_to_the_transcript_they_guard', () => {
    expect(lockId('80a43d49-abc.jsonl.lock')).toBe('80a43d49-abc')
    expect(lockId('80a43d49-abc.jsonl.writer.lock')).toBe('80a43d49-abc')
  })

  it('lock_suffix_and_lockId_agree_on_what_is_a_lock', () => {
    // The regex is exported for the apply phase's sibling-transcript lookup; the two must keep
    // recognising the same names or plan and apply diverge on which lock guards which file.
    for (const name of ['a.jsonl.lock', 'a.jsonl.writer.lock']) {
      expect(LOCK_SUFFIX.test(name)).toBe(true)
      expect(lockId(name)).toBe('a')
    }
    expect(LOCK_SUFFIX.test('a.jsonl')).toBe(false)
  })
})
