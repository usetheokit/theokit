/**
 * keepLast protects the newest transcripts, of live and dead projects alike.
 */
import { existsSync, symlinkSync } from 'node:fs'
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

describe('the keepLast quota', () => {
  it('keeps the newest transcripts however old they are', async () => {
    const a = put(tree.live, 'a.jsonl', 100)
    const b = put(tree.live, 'b.jsonl', 200)
    const c = put(tree.live, 'c.jsonl', 300)
    const plan = await planAllProjectsOnDisk(opts({ keepLast: 2 }))
    expect(targets(plan)).toEqual([c])
    expect(targets(plan)).not.toContain(a)
    expect(targets(plan)).not.toContain(b)
  })

  it('protects the newest of a DEAD project and collects beyond the slice', async () => {
    const gone = join(tree.base, 'gone')
    const newest = put(gone, 'new.jsonl', 50)
    const old = put(gone, 'old.jsonl', 100)
    const plan = await planAllProjectsOnDisk(opts())
    expect(targets(plan)).toEqual([old])
    expect(targets(plan)).not.toContain(newest)
  })

  it('an unstattable transcript is never collected and keeps its project whole', async () => {
    const fresh = put(tree.live, 'fresh.jsonl', 1)
    const old = put(tree.live, 'old.jsonl', 100)
    const dangling = join(tree.root, encodeProjectDir(tree.live), 'ghost.jsonl')
    symlinkSync(join(tree.base, 'nowhere'), dangling)
    const plan = await planAllProjectsOnDisk(opts())
    // Its owner cannot be established, so nothing in the project is collected (stricter than before).
    expect(plan.candidates).toEqual([])
    expect(existsSync(old) && existsSync(fresh)).toBe(true)
    expect(plan.kept).toContain(encodeProjectDir(tree.live))
    expect(targets(plan)).not.toContain(dangling)
  })
})
