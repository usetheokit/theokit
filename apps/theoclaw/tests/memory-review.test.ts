import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryStore } from '../src/memory/memory-store.js'
import { sessionSearchTool } from '../src/memory/memory-tools.js'
import { recordTurn } from '../src/memory/wiring.js'
import { say, seen } from './memory-sdk-support.js'

interface Callable {
  name: string
  handler: (input: unknown) => Promise<string> | string
}
afterEach(() => vi.unstubAllEnvs())

const dir = () => mkdtempSync(join(tmpdir(), 'theoclaw-memory-'))
const turn = (surface: string, user: string) => ({
  surface,
  sessionKey: `${surface}-1`,
  user,
  assistant: 'ok',
  at: '2026-11-09T10:00:00Z',
})

describe('memory across surfaces (OC-56, Hermes row 3)', () => {
  it('finds a turn stored by another surface, through a second store on the same directory', () => {
    const d = dir()
    new MemoryStore(d).appendTurn(turn('telegram', 'my cat is called Pelmeni'))
    expect(new MemoryStore(d).search('what is my cat called').map((h) => h.surface)).toEqual(['telegram'])
    expect(new MemoryStore(d).search('zzz')).toEqual([])
  })

  it('exposes the search as the session_search tool', async () => {
    const store = new MemoryStore(dir())
    store.appendTurn(turn('webchat', 'deploy goes on Fridays'))
    const tool = sessionSearchTool(store) as unknown as Callable
    expect(tool.name).toBe('session_search')
    const out = JSON.stringify(await tool.handler({ query: 'deploy' }))
    expect(out).toContain('webchat')
    expect(out).toContain('deploy goes on Fridays')
  })
})

describe('the SDK reviewer (#1834)', () => {
  it('has a reviewer save a fact the next session recalls; a fresh store recalls nothing', { timeout: 60_000 }, async () => {
    const state = dir()
    const saving = await say(state, 'tui', 'owner', true)
    // The second turn's review fails inside the SDK (the reviewer id is taken); the turn still ends.
    const next = await say(state, 'tui', 'owner', false)
    const fresh = await say(dir(), 'tui', 'owner', false)
    try {
      expect(saving.requests.length).toBeGreaterThanOrEqual(3)
      expect(seen(next)).toContain('Quillon-7731')
      expect(seen(fresh)).not.toContain('Quillon-7731')
    } finally {
      await Promise.all([saving.close(), next.close(), fresh.close()])
    }
  })
})

describe('a failed turn append (#1462)', () => {
  it('is reported and never throws, and the next turn is still recorded', () => {
    const appended: unknown[] = []
    let calls = 0
    const store = {
      appendTurn: (turn: unknown) => {
        if (++calls === 1) throw new Error('ENOENT')
        appended.push(turn)
      },
    } as never
    const errors: string[] = []
    const turn = { surface: 's', sessionKey: 'k', user: 'u', assistant: 'a', at: 't' }
    recordTurn(store, turn, (line) => errors.push(line))
    recordTurn(store, turn, (line) => errors.push(line))
    expect(errors).toHaveLength(1)
    expect(appended).toHaveLength(1)
  })
})
