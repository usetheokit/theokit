/**
 * The collection window is refused below the floor, not normalised (all-projects path).
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

describe('the collection floor', () => {
  it('refuses a window below the floor, and says it was refused', async () => {
    for (const maxAgeDays of [0, -1]) {
      await expect(planAllProjectsOnDisk(opts({ maxAgeDays }))).rejects.toThrow(/maxAgeDays/)
    }
  })

  it('accepts the floor itself', async () => {
    await expect(planAllProjectsOnDisk(opts({ maxAgeDays: 1 }))).resolves.toBeDefined()
  })
})
