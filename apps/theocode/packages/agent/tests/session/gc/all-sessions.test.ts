/**
 * The plan consults the writer lease and collects only the SDK’s own temp files.
 */
import { existsSync, writeFileSync } from 'node:fs'
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

import { planAllProjectsOnDisk, runAllProjectsOnDisk } from '../../../src/session/gc/filesystem.js'
import { claimRoot } from '../../../src/session/gc/root-ownership.js'

beforeEach(() => {
  setup(claimRoot)
})
afterEach(teardown)

describe('what the plan collects', () => {
  it('a transcript with a live writer is not planned, at plan time and at apply time', async () => {
    put(tree.live, 'newest.jsonl', 1)
    const writing = put(tree.live, 'writing.jsonl', 100)
    const idle = put(tree.live, 'idle.jsonl', 100)
    state.writers.add(writing)
    const plan = await planAllProjectsOnDisk(opts())
    expect(targets(plan)).toEqual([idle])
    state.writers.add(idle) // gained a writer after the plan
    const result = await runAllProjectsOnDisk(plan, opts({ apply: true }))
    expect(existsSync(idle)).toBe(true)
    expect(result.removed).not.toContain(idle)
    expect(result.errors.join('\n')).toMatch(/refused/)
  })

  it('only the SDK’s own temp files are collectable', async () => {
    put(tree.live, 'newest.jsonl', 1)
    const dir = join(tree.root, encodeProjectDir(tree.live))
    const foreign = join(dir, 'notes.txt.tmp')
    const sdk = join(dir, 'state.json.1234.0123456789abcdef.tmp')
    for (const f of [foreign, sdk]) {
      writeFileSync(f, '')
      age(f, 100)
    }
    const plan = await planAllProjectsOnDisk(opts())
    expect(targets(plan)).toEqual([sdk])
  })
})
