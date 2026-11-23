/**
 * A run that could not look never reports an empty result, and a cursor-paged registry is refused.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { encodeProjectDir } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { opts, setup, teardown, tree } from './all-projects-fixture.js'

vi.mock('../../../src/session/agent-list.js', async (original) => {
  const { state } = await import('./all-projects-state.js')
  return {
    ...(await original<typeof import('../../../src/session/agent-list.js')>()),
    listAgents: (cwd: string) => {
      if (state.failRegistry.has(cwd)) return Promise.reject(new Error('registry down'))
      return Promise.resolve(state.registry.get(cwd) ?? [])
    },
  }
})
vi.mock('@theokit/agents/persistence', async (original) => {
  const { state } = await import('./all-projects-state.js')
  return {
    ...(await original<typeof import('@theokit/agents/persistence')>()),
    sessionHasWriter: (path: string) => state.writers.has(path),
  }
})

import { planAllProjectsOnDisk } from '../../../src/session/gc/filesystem.js'
import { claimRoot } from '../../../src/session/gc/root-ownership.js'

beforeEach(() => {
  setup(claimRoot)
})
afterEach(teardown)

describe('fail-open', () => {
  it('a project root that cannot be listed is an error, not "nothing to collect"', async () => {
    const file = join(tree.base, 'a-file')
    writeFileSync(file, 'x')
    const plan = await planAllProjectsOnDisk({ projectsRoot: file, keepLast: 1, maxAgeDays: 7 })
    expect(plan.candidates).toEqual([])
    expect(plan.errors.length).toBeGreaterThan(0)
  })

  it('a listing that returns a cursor is refused, a drained one returns its items', async () => {
    const { CursorNotDrainedError, listAgents: realListAgents } = await vi.importActual<
      typeof import('../../../src/session/agent-list.js')
    >('../../../src/session/agent-list.js')
    await expect(
      realListAgents('/p', () => Promise.resolve({ items: [], nextCursor: 'page-2' })),
    ).rejects.toThrow(CursorNotDrainedError)
    await expect(
      realListAgents('/p', () => Promise.resolve({ items: [{ agentId: 'a1' }] })),
    ).resolves.toEqual([{ agentId: 'a1' }])
  })
})
