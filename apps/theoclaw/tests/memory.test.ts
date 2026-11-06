import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CustomTool } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import type { TurnAgent } from '../src/agent-port.js'
import type { TurnRunner } from '../src/control-plane/turn.js'
import { MemoryStore } from '../src/memory/memory-store.js'
import { memorySaveTool, sessionSearchTool } from '../src/memory/memory-tools.js'
import { withMemory } from '../src/memory/memory-wiring.js'

const dirs: string[] = []
function store(): MemoryStore {
  const dir = mkdtempSync(join(tmpdir(), 'theoclaw-memory-'))
  dirs.push(dir)
  return new MemoryStore(join(dir, 'memory'))
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Runs the tool's handler; the SDK serializes a result to JSON text. */
async function call(tool: CustomTool, input: unknown): Promise<unknown> {
  const result = await (tool as unknown as { handler: (input: unknown, context?: unknown) => unknown }).handler(input)
  return typeof result === 'string' ? JSON.parse(result) : result
}

function runnerSaying(reply: string, seen: string[] = []): TurnRunner {
  return async (message, emit) => {
    seen.push(message)
    emit({ type: 'text_delta', content: reply } as never)
    return { ok: true }
  }
}

describe('memory across surfaces', () => {
  it('session_search finds a turn stored by another surface', async () => {
    const s = store()
    await withMemory(runnerSaying('Noted: the zebra password is hidden.'), { store: s, surface: 'webchat', write: () => undefined })('remember the zebra password', () => undefined)
    const hits = (await call(sessionSearchTool(s), { query: 'zebra' })) as { hits: { surface: string; user: string }[] }
    expect(hits.hits).toHaveLength(1)
    expect(hits.hits[0]?.surface).toBe('webchat')
    expect(s.searchSessions('nothing matches')).toEqual([])
  })

  it('a forked reviewer saves a fact the next turn is shown; it holds only memory_save', async () => {
    const s = store()
    const toolsSeen: string[][] = []
    const build = async (options: { tools: readonly CustomTool[] }): Promise<TurnAgent> => {
      toolsSeen.push(options.tools.map((t) => (t as unknown as { name: string }).name))
      return {
        async send() {
          await call(options.tools[0] as CustomTool, { fact: 'The user prefers metric units.' })
          return { stream: async function* () {}, wait: async () => ({ status: 'finished' }), cancel: async () => undefined }
        },
      } as unknown as TurnAgent
    }
    let review: Promise<void> | undefined
    const seen: string[] = []
    const turn = withMemory(runnerSaying('ok', seen), { store: s, surface: 'control', build: build as never, write: () => undefined, onReview: (p) => (review = p) })
    await turn('I like metric units', () => undefined)
    await review
    expect(toolsSeen).toEqual([['memory_save']])
    expect(s.facts()).toEqual(['The user prefers metric units.'])
    await turn('what units?', () => undefined)
    expect(seen[1]).toContain('The user prefers metric units.')
    expect(seen[1]).toContain('what units?')
  })

  it('a failing reviewer is logged and never fails the turn; facts dedupe', async () => {
    const s = store()
    const lines: string[] = []
    let review: Promise<void> | undefined
    const outcome = await withMemory(runnerSaying('ok'), {
      store: s,
      surface: 'control',
      build: async () => { throw new Error('boom') },
      write: (l) => lines.push(l),
      onReview: (p) => (review = p),
    })('hi', () => undefined)
    await review
    expect(outcome.ok).toBe(true)
    expect(lines[0]).toContain('review failed')
    expect(await call(memorySaveTool(s), { fact: 'a' })).toEqual({ saved: true })
    expect(await call(memorySaveTool(s), { fact: 'A' })).toEqual({ saved: false })
  })
})
