/**
 * The guard half of the all-projects sweep, at its own module boundary.
 *
 * Most guard behavior is exercised end-to-end through `planSessionGCAllProjects` (keep-last-quota,
 * pointer-namespace, resume-protection, fail-open). What these tests add is the contract the
 * B-143 fix named and no test asserted directly: a failed read reports WHICH read failed, because
 * `registry unavailable` for a pointer problem sends the operator to the wrong file.
 */
import { describe, expect, it } from 'vitest'

import { resolveGuards } from '../../../src/session/gc/all-sessions-guards.js'

const ALIVE = { state: 'ALIVE', cwd: '/some/project' } as const

describe('resolveGuards', () => {
  it('a_pointer_read_failure_is_named_as_the_pointer', async () => {
    const result = await resolveGuards(ALIVE, [], 0, {
      readPointer: () => {
        throw new Error('EACCES')
      },
      listRegistry: async () => [],
    })

    expect(result).toEqual({ failedRead: 'pointer' })
  })

  it('a_registry_read_failure_is_named_as_the_registry', async () => {
    const result = await resolveGuards(ALIVE, [], 0, {
      readPointer: () => undefined,
      listRegistry: async () => {
        throw new Error('registry gone')
      },
    })

    expect(result).toEqual({ failedRead: 'registry' })
  })

  it('an_undetermined_project_gets_empty_guards_not_a_throw', async () => {
    const result = await resolveGuards({ state: 'UNDETERMINED', reason: 'no cwd' }, [], 5, {
      readPointer: () => {
        throw new Error('must not be consulted')
      },
      listRegistry: async () => {
        throw new Error('must not be consulted')
      },
    })

    expect(result).toEqual({ protectedIds: new Set(), registry: [] })
  })
})
