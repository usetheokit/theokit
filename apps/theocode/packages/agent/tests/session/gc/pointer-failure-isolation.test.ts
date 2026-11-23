/**
 * A failing pointer read is isolated to its project and named for what it is.
 */
import { mkdirSync } from 'node:fs'
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

describe('a failing pointer read is isolated to its project', () => {
  it('a pointer that cannot be read skips only its own project and names the pointer', async () => {
    put(tree.live, 'newest.jsonl', 1)
    const brokenOld = put(tree.live, 'old.jsonl', 100)
    mkdirSync(join(tree.live, '.theokit', 'tui-session'), { recursive: true }) // EISDIR on read
    put(tree.other, 'newest.jsonl', 1)
    const healthyOld = put(tree.other, 'old.jsonl', 100)
    const plan = await planAllProjectsOnDisk(opts())
    expect(targets(plan)).toContain(healthyOld)
    expect(targets(plan)).not.toContain(brokenOld)
    expect(plan.errors.join('\n')).toMatch(/pointer read failed/)
    expect(plan.errors.join('\n')).not.toMatch(/registry read failed/)
  })
})
