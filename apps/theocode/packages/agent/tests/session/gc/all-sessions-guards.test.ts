/**
 * The guard half of the all-projects sweep, at the boundary the framework planner now owns.
 *
 * Most guard behavior is exercised end-to-end through the planner (keep-last-quota,
 * pointer-namespace, resume-protection, fail-open). What these tests add is the contract the
 * B-143 fix named and no test asserted directly: a failed read reports WHICH read failed, because
 * `registry unavailable` for a pointer problem sends the operator to the wrong file.
 */
import { describe, expect, it } from 'vitest'

import { planSessionGCAllProjects } from './legacy-plan.js'

const DAY = 86_400_000
const NOW = 1_000 * DAY

function options(overrides: Record<string, unknown> = {}) {
  return {
    now: () => NOW,
    keepLast: 1,
    maxAgeDays: 30,
    listProjects: () => ['proj'],
    listProject: () => [
      { name: 'new.jsonl', isDirectory: false, mtimeMs: NOW - 2 * DAY },
      { name: 'old.jsonl', isDirectory: false, mtimeMs: NOW - 90 * DAY },
    ],
    classify: () => ({ state: 'ALIVE' as const, cwd: '/some/project' }),
    listRegistry: async () => [],
    hasLiveWriter: () => false,
    readPointer: () => undefined,
    ...overrides,
  } as Parameters<typeof planSessionGCAllProjects>[0]
}

describe('the guards of one project', () => {
  it('a_pointer_read_failure_is_named_as_the_pointer', async () => {
    const plan = await planSessionGCAllProjects(
      options({
        readPointer: () => {
          throw new Error('EACCES')
        },
      }),
    )

    expect(plan.candidates).toEqual([])
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toMatch(/pointer read failed/)
    expect(plan.errors[0]).not.toMatch(/registry/)
  })

  it('a_registry_read_failure_is_named_as_the_registry', async () => {
    const plan = await planSessionGCAllProjects(
      options({
        listRegistry: async () => {
          throw new Error('registry gone')
        },
      }),
    )

    expect(plan.candidates).toEqual([])
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toMatch(/registry read failed/)
    expect(plan.errors[0]).not.toMatch(/pointer/)
  })

  it('an_undetermined_project_gets_empty_guards_not_a_throw', async () => {
    const plan = await planSessionGCAllProjects(
      options({
        classify: () => ({ state: 'UNDETERMINED' as const, reason: 'no cwd' }),
        readPointer: () => {
          throw new Error('must not be consulted')
        },
        listRegistry: async () => {
          throw new Error('must not be consulted')
        },
      }),
    )

    expect(plan.candidates).toEqual([])
    expect(plan.errors).toEqual([])
    expect(plan.kept).toContain('proj')
  })
})
