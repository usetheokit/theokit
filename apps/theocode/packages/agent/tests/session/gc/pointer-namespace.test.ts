/**
 * The pointer guard and the protected set speak one language: the session the TUI pointer names is kept.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { encodeProjectDir } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { opts, point, put, session, setup, targets, teardown, tree } from './all-projects-fixture.js'

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

describe('the TUI pointer', () => {
  it('is collectable without it, and protected with it, however stale', async () => {
    put(tree.live, 'newest.jsonl', 1)
    const stale = session(tree.live, 'sess-1', 100)
    expect(targets(await planAllProjectsOnDisk(opts()))).toContain(stale)
    point(tree.live, 'sess-1')
    expect(targets(await planAllProjectsOnDisk(opts()))).not.toContain(stale)
  })
})
