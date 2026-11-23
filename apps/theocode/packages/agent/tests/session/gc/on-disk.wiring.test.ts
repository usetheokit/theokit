/**
 * The on-disk wiring of the delete path: apply removes, a dry run leaves the file.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { encodeProjectDir } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { opts, put, setup, teardown, tree } from './all-projects-fixture.js'

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

describe('the on-disk wiring of the delete path', () => {
  it('apply removes the file from the filesystem, a dry run does not', async () => {
    put(tree.live, 'newest.jsonl', 1)
    const old = put(tree.live, 'old.jsonl', 100)
    const plan = await planAllProjectsOnDisk(opts())
    const dry = await runAllProjectsOnDisk(plan, opts())
    expect(dry.dryRun).toBe(true)
    expect(existsSync(old)).toBe(true)
    const done = await runAllProjectsOnDisk(plan, opts({ apply: true }))
    expect(existsSync(old), 'the collector reported a removal it did not perform').toBe(false)
    expect(done.removed).toContain(old)
    expect(done.errors).toEqual([])
  })
})
