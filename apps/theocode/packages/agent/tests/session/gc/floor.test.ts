/**
 * The age window is a floor: nothing inside it is planned, anything past it is.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { encodeProjectDir } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { opts, put, setup, targets, teardown, tree } from './all-projects-fixture.js'

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

describe('the age window', () => {
  it('never plans a transcript inside the window, and plans one past it', async () => {
    put(tree.live, 'newest.jsonl', 0.1)
    const inside = put(tree.live, 'inside.jsonl', 3)
    const past = put(tree.live, 'past.jsonl', 30)
    const plan = await planAllProjectsOnDisk(opts({ keepLast: 1 }))
    expect(targets(plan)).toContain(past)
    expect(targets(plan)).not.toContain(inside)
  })
})
