/**
 * A session the registry lists is kept however old; archived listings protect nothing.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { encodeProjectDir } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { opts, put, session, setup, targets, teardown, tree } from './all-projects-fixture.js'
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

import { planAllProjectsOnDisk } from '../../../src/session/gc/filesystem.js'
import { claimRoot } from '../../../src/session/gc/root-ownership.js'

beforeEach(() => {
  setup(claimRoot)
})
afterEach(teardown)

describe('a session the registry lists', () => {
  it('keeps a registered session however old, collects it when unlisted, ignores an archived listing', async () => {
    put(tree.live, 'newest.jsonl', 1)
    const stale = session(tree.live, 'sess-r', 100)
    expect(targets(await planAllProjectsOnDisk(opts()))).toContain(stale)
    state.registry.set(tree.live, [{ agentId: 'sess-r' }])
    expect(targets(await planAllProjectsOnDisk(opts()))).not.toContain(stale)
    state.registry.set(tree.live, [{ agentId: 'sess-r', archived: true }])
    const archived = await planAllProjectsOnDisk(opts())
    expect(targets(archived)).toContain(stale)
    // A registered transcript is removed through its SESSION id, which only the plan can pair.
    expect(archived.framework?.candidates.find((c) => c.target === stale)?.sessionId).toBe('sess-r')
  })
})
