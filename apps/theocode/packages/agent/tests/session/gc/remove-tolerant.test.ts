/**
 * The idempotent-delete rule both GC apply phases share, pinned in one place.
 *
 * The 2026-09-10 architecture review measured this business rule implemented twice — in
 * `runSessionGC` (per-session) and `runSessionGCAllProjects` (all projects) — with the same
 * semantics and the same `id: message` error shape consumers parse. These tests lock the rule at
 * its single implementation, so a change to it (tolerating another code, changing the shape) is a
 * change to one function with one suite going red.
 */
import { describe, expect, it } from 'vitest'

import { removeTolerant } from '../../../src/session/gc/remove-tolerant.js'

function enoent(): NodeJS.ErrnoException {
  const err = new Error('no such file') as NodeJS.ErrnoException
  err.code = 'ENOENT'
  return err
}

describe('removeTolerant', () => {
  it('a_successful_delete_is_recorded_as_removed', async () => {
    const removed: string[] = []
    const errors: string[] = []

    await removeTolerant('t-1', async () => {}, removed, errors)

    expect(removed).toEqual(['t-1'])
    expect(errors).toEqual([])
  })

  it('enoent_counts_as_removed_because_gone_is_what_removal_means', async () => {
    const removed: string[] = []
    const errors: string[] = []

    await removeTolerant(
      't-2',
      async () => {
        throw enoent()
      },
      removed,
      errors,
    )

    expect(removed).toEqual(['t-2'])
    expect(errors).toEqual([])
  })

  it('any_other_error_is_collected_as_id_colon_message_and_does_not_throw', async () => {
    const removed: string[] = []
    const errors: string[] = []

    await removeTolerant(
      't-3',
      async () => {
        throw new Error('EACCES: permission denied')
      },
      removed,
      errors,
    )

    expect(removed).toEqual([])
    // The `id: message` shape is a contract: both sweeps report through it and callers parse it.
    expect(errors).toEqual(['t-3: EACCES: permission denied'])
  })
})
