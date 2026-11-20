/**
 * The guard half of the all-projects sweep, at its own module boundary.
 *
 * Most guard behavior is exercised end-to-end through the planner (keep-last-quota,
 * pointer-namespace, resume-protection, fail-open). What these tests add is the contract the
 * B-143 fix named and no test asserted directly: a failed read reports WHICH read failed (now the framework's `fail()` error, observed on the plan), because
 * `registry unavailable` for a pointer problem sends the operator to the wrong file.
 */
import { describe, expect, it } from 'vitest'

import { planVirtual } from './plan-harness.js'

const CWD = '/some/project'
const entries = [{ name: 'a.jsonl', ageDays: 90 }]
const alive = () => 'alive' as const

describe('the guard reads', () => {
  it('a_pointer_read_failure_is_named_as_the_pointer', async () => {
    const plan = await planVirtual({
      projects: { [CWD]: entries },
      liveness: alive,
      pointer: () => {
        throw new Error('EACCES')
      },
    })

    expect(plan.errors.map((e) => e.message).join(' ')).toContain('pointer')
    expect(plan.errors.map((e) => e.message).join(' ')).not.toContain('registry read failed')
    expect(plan.candidates).toEqual([])
  })

  it('a_registry_read_failure_is_named_as_the_registry', async () => {
    const plan = await planVirtual({
      projects: { [CWD]: entries },
      liveness: alive,
      registry: async () => {
        throw new Error('registry gone')
      },
    })

    expect(plan.errors.map((e) => e.message).join(' ')).toContain('registry read failed')
    expect(plan.candidates).toEqual([])
  })

  it('an_undetermined_project_gets_empty_guards_not_a_throw', async () => {
    const plan = await planVirtual({
      projects: { [CWD]: entries },
      liveness: () => 'undetermined',
      keepLast: 5,
      pointer: () => {
        throw new Error('must not be consulted')
      },
      registry: async () => {
        throw new Error('must not be consulted')
      },
    })

    expect(plan.errors).toEqual([])
    expect(plan.candidates).toEqual([])
    expect(plan.kept.map((k) => k.project)).toHaveLength(1)
  })
})
