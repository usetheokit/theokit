/**
 * The sweep speaks one id namespace: session ids pair with transcripts at plan time, and apply re-checks the pointer.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { encodeProjectDir } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DAY, opts, point, put, session, setup, targets, teardown, tree } from './all-projects-fixture.js'
import { state } from './all-projects-state.js'

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

import { planAllProjectsOnDisk, runAllProjectsOnDisk } from '../../../src/session/gc/filesystem.js'
import { claimRoot } from '../../../src/session/gc/root-ownership.js'

beforeEach(() => {
  setup(claimRoot)
})
afterEach(teardown)

describe('the all-projects sweep id namespace', () => {
  it('apply refuses a transcript whose session became the pointer after the plan', async () => {
    put(tree.live, 'newest.jsonl', 1)
    const stale = session(tree.live, 'sess-2', 100)
    const plan = await planAllProjectsOnDisk(opts())
    expect(targets(plan)).toContain(stale)
    point(tree.live, 'sess-2')
    const result = await runAllProjectsOnDisk(plan, opts({ apply: true }))
    expect(existsSync(stale)).toBe(true)
    expect(result.errors.join('\n')).toMatch(/refused/)
  })

  it('collects an old registry entry with no transcript, never an undated one or one whose transcript exists', async () => {
    put(tree.live, 'newest.jsonl', 1)
    session(tree.live, 'on-disk', 1)
    state.registry.set(tree.live, [
      { agentId: 'on-disk', lastModified: Date.now() - 100 * DAY },
      { agentId: 'orphan', lastModified: Date.now() - 100 * DAY },
      { agentId: 'undated' },
    ])
    const plan = await planAllProjectsOnDisk(opts())
    expect(plan.candidates.filter((c) => c.kind === 'registry').map((c) => c.target)).toEqual([
      'orphan',
    ])
  })
})
