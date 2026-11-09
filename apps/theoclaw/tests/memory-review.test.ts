import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MemoryStore } from '../src/memory/memory-store.js'
import { saveMemoryTool, sessionSearchTool } from '../src/memory/memory-tools.js'
import { afterTurn } from '../src/memory/turn-review.js'

interface Callable {
  name: string
  handler: (input: unknown) => Promise<string> | string
}
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
    const out = JSON.parse(await tool.handler({ query: 'deploy' })) as { results: { surface: string }[] }
    expect(out.results[0]?.surface).toBe('webchat')
  })

  it('has a reviewer save a fact the next session recalls, and a failing reviewer does not reject', async () => {
    const d = dir()
    const store = new MemoryStore(d)
    const save = saveMemoryTool(store) as unknown as Callable
    await afterTurn(store, turn('tui', 'I work in Lisbon'), async (prompt) => {
      expect(prompt).toContain('I work in Lisbon')
      await save.handler({ fact: 'The owner works in Lisbon' })
      await save.handler({ fact: 'The owner works in Lisbon' })
    })
    expect(store.facts()).toEqual(['The owner works in Lisbon'])
    expect(new MemoryStore(d).recallSection()).toContain('- The owner works in Lisbon')
    expect(new MemoryStore(dir()).recallSection()).toBe('')

    const errors: unknown[] = []
    await afterTurn(store, turn('tui', 'x'), () => Promise.reject(new Error('boom')), (e) => errors.push(e))
    expect(errors).toHaveLength(1)
  })
})
