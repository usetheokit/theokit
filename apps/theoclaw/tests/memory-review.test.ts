import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryStore } from '../src/memory/memory-store.js'
import { sessionSearchTool } from '../src/memory/memory-tools.js'
import { recordTurn } from '../src/memory/wiring.js'
import { FACT, say, seen } from './memory-sdk-support.js'

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

describe('memory across surfaces, the reviewer (#1834)', () => {
  it('has a reviewer save a fact the next session recalls, and a failing reviewer does not reject', { timeout: 60_000 }, async () => {
    const state = dir()
    // The reviewer saves the same fact twice in one review: it is kept once.
    const twice = { toolCalls: [{ name: 'save_memory', args: { fact: FACT } }, { name: 'save_memory', args: { fact: FACT } }] }
    const saving = await say(state, 'tui', 'owner', true, {}, { replies: [{ text: 'noted' }, twice, { text: 'done' }], message: 'I work in Lisbon' })
    // The reviewer was told the turn it reviews.
    expect(JSON.stringify(saving.requests[1])).toContain('I work in Lisbon')
    // The second turn's review fails inside the SDK (the reviewer id is taken); the turn still ends.
    const next = await say(state, 'tui', 'owner', false)
    const fresh = await say(dir(), 'tui', 'owner', false)
    try {
      expect(JSON.stringify(next.requests[0]).split('Quillon-7731')).toHaveLength(2)
      expect(seen(fresh)).not.toContain('Quillon-7731')
    } finally {
      await Promise.all([saving.close(), next.close(), fresh.close()])
    }
  })
})

describe('a failed turn append (#1462)', () => {
  it('reaches onError and the next turn is still recorded and reviewed', { timeout: 60_000 }, async () => {
    const state = dir()
    // The turn log's file is a directory, so every append fails.
    mkdirSync(join(state, 'memory', 'turns.jsonl'), { recursive: true })
    const lines: string[] = []
    const saving = await say(state, 'webchat', 'guest', true, {}, { lines })
    const next = await say(state, 'webchat', 'guest', false, {}, { lines })
    try {
      expect(lines.filter((line) => line.includes('memory turn record failed'))).toHaveLength(2)
      // Reviewed despite the failed append, and recalled by the next turn.
      expect(saving.requests.length).toBeGreaterThanOrEqual(3)
      expect(seen(next)).toContain('Quillon-7731')
    } finally {
      await Promise.all([saving.close(), next.close()])
    }
  })

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
