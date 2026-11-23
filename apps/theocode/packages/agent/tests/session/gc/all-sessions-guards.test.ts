/**
 * The guards name the read that failed, and a project that cannot be classified is kept.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { encodeProjectDir } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { age, opts, put, setup, targets, teardown, tree } from './all-projects-fixture.js'
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

describe('the guards', () => {
  it('a registry that cannot be read is named as the registry', async () => {
    put(tree.live, 'newest.jsonl', 1)
    const old = put(tree.live, 'old.jsonl', 100)
    state.failRegistry.add(tree.live)
    const plan = await planAllProjectsOnDisk(opts())
    expect(targets(plan)).not.toContain(old)
    expect(plan.errors.join('\n')).toMatch(/registry read failed/)
  })

  it('a project that cannot be classified is kept whole', async () => {
    const dir = join(tree.root, 'mystery')
    mkdirSync(dir)
    writeFileSync(join(dir, 'x.jsonl'), '{}\n')
    age(join(dir, 'x.jsonl'), 100)
    const plan = await planAllProjectsOnDisk(opts())
    expect(plan.candidates).toEqual([])
    expect(plan.kept).toContain('mystery')
  })
})
