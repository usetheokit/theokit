/**
 * B-003 — the live-session pointer is read one way, and unreadable means refuse.
 *
 * The pointer is the framework's `last-session`. The GC and the delete guard use what
 * `readPointerId` returns as a deletion decision, so an unreadable file must refuse.
 */
import { sessionPointerPath } from '@theokit/agents/session'
import { describe, expect, it } from 'vitest'

import { readPointerId } from '../../../src/session/session-ops.js'

const fail = (code: string) => () => {
  throw Object.assign(new Error(code), { code })
}

describe('B-003 — reading the live-session pointer', () => {
  it('test_a_missing_pointer_means_no_live_session', () => {
    expect(readPointerId('/p', '/r', fail('ENOENT'))).toBeUndefined()
  })

  it('test_an_unreadable_pointer_REFUSES_instead_of_reporting_no_session', () => {
    expect(() => readPointerId('/p', '/r', fail('EACCES'))).toThrow(/refusing/)
  })

  it('test_an_empty_pointer_means_no_live_session', () => {
    expect(readPointerId('/p', '/r', () => '  \n')).toBeUndefined()
  })

  it('test_a_written_pointer_is_returned_trimmed', () => {
    expect(readPointerId('/p', '/r', () => 'tui-abc123\n')).toBe('tui-abc123')
  })

  it('test_the_pointer_path_is_the_frameworks', () => {
    let seen = ''
    readPointerId('/p', '/r', (path) => {
      seen = path
      return ''
    })
    expect(seen).toBe(sessionPointerPath('/p', '/r'))
  })
})
