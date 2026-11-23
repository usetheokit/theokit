/**
 * B-003 — the live-session pointer is read one way, and unreadable means refuse.
 *
 * The pointer at `<cwd>/.theokit/tui-session` names the session a running TUI is writing to. The GC
 * consults it to decide what NOT to delete, so what it returns is a deletion decision.
 *
 * It was derived inline at four sites with three different error postures. Two of them
 * (`gc/filesystem.ts`, in both the plan and the apply phase) swallowed every error and returned
 * `undefined` — which the caller reads as "there is no live session", so an EACCES or EIO silently
 * disarmed the guard on BOTH layers at once. The third (`session-ops.ts`) returned `[]`, disarming
 * the fork guard the same way. The fourth (`gc/per-session.ts`) got it right and says so in its own
 * message: *refusing to GC (would risk the live session)*.
 *
 * One piece of knowledge, four representations — and the two that were wrong are the ones on the
 * path that deletes files.
 */
import { describe, expect, it } from 'vitest'

import { pointerPath, readPointerId } from '../../../src/session/gc/pointer.js'

const enoent = (): never => {
  throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })
}
const eacces = (): never => {
  throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
}

describe('B-003 — reading the live-session pointer', () => {
  it('test_a_missing_pointer_means_no_live_session', () => {
    // ENOENT is the ordinary case: no TUI has ever run in this directory.
    expect(readPointerId('/p', enoent)).toBeUndefined()
  })

  it('test_an_unreadable_pointer_REFUSES_instead_of_reporting_no_session', () => {
    expect(
      () => readPointerId('/p', eacces),
      'an unreadable pointer was reported as "no live session". The caller uses that answer to ' +
        'decide what to delete, so a permissions error silently removed the live session from the ' +
        'protected set — on a path that unlinks transcripts.',
    ).toThrow(/refusing/i)
  })

  it('test_an_empty_pointer_means_no_live_session', () => {
    expect(readPointerId('/p', () => '  \n')).toBeUndefined()
  })

  it('test_a_written_pointer_is_returned_trimmed', () => {
    expect(readPointerId('/p', () => 'tui-abc123\n')).toBe('tui-abc123')
  })

  it('test_the_pointer_path_is_derived_in_one_place', () => {
    expect(pointerPath('/proj')).toBe('/proj/.theokit/tui-session')
  })
})
