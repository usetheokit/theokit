/**
 * How a lock maps to the transcript it guards.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { encodeProjectDir } from '@theokit/agents/persistence'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { age, opts, put, setup, targets, teardown, tree } from './all-projects-fixture.js'

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

describe('lock and transcript names', () => {
  it('a lock beside a live transcript is kept, an orphan one is collected', async () => {
    put(tree.live, 'newest.jsonl', 1)
    put(tree.live, 'sibling.jsonl', 100)
    const dir = join(tree.root, encodeProjectDir(tree.live))
    const kept = join(dir, 'sibling.jsonl.writer.lock')
    const orphan = join(dir, 'gone.jsonl.writer.lock')
    for (const f of [kept, orphan]) {
      writeFileSync(f, '')
      age(f, 100)
    }
    const plan = await planAllProjectsOnDisk(opts({ keepLast: 2 }))
    expect(targets(plan)).toContain(orphan)
    expect(targets(plan)).not.toContain(kept)
  })
})
