import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MessageEvent } from '@theokit/gateway'
import type { AgentOptions } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { UNTRUSTED_CONTENT_NOTICE } from '../src/agent/untrusted-content.js'
import { MemoryStore } from '../src/memory/memory-store.js'
import { theoClawAgentOptions } from '../src/agent/create-agent.js'
import { chatSessions } from '../src/sessions/chat-sessions.js'

const ENV = { THEOCLAW_MODEL: 'm', OPENROUTER_API_KEY: 'k', THEOCLAW_TRANSCRIPTS: 'on' }
const event = (platform: string) =>
  ({ platform, sender: { id: 'u' }, channel: { type: 'dm', id: 'u' } }) as unknown as MessageEvent

interface Callable {
  name: string
  handler: (input: unknown) => Promise<string> | string
}

/** A scripted agent: it answers `answer`; given `save_memory`, it saves `fact` the way a model would. */
function scripted(options: AgentOptions, answer: string, fact?: string) {
  const sent: string[] = []
  return {
    sent,
    send: async (message: string) => {
      sent.push(message)
      const save = (options.tools as unknown as Callable[] | undefined)?.find((tool) => tool.name === 'save_memory')
      if (save !== undefined && fact !== undefined) await save.handler({ query: fact })
      return {
        stream: async function* () {},
        wait: async () => ({ status: 'finished', result: answer }),
        cancel: async () => undefined,
      }
    },
    dispose: async () => undefined,
  }
}

describe('memory wired into the chat sessions (OC-56, Hermes row 3)', () => {
  it('stores a turn per surface, runs a forked reviewer with save_memory alone, and keeps its fact', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-mem-'))
    const opened: { id: string; options: AgentOptions }[] = []
    const { sessions, withAgent, memory } = chatSessions({
      env: { ...ENV, THEOCLAW_WORKSPACE: workspace },
      write: () => undefined,
      getOrCreate: async (id, options) => {
        opened.push({ id, options })
        return scripted(options, 'noted', id.includes('-review-') ? 'The owner lives in Porto' : undefined) as never
      },
    })
    for (const platform of ['telegram', 'line']) {
      await withAgent(event(platform), async (lease) => {
        const run = await lease.agent.send(`I live in Porto (${platform})`)
        await run.wait()
        lease.release()
      })
    }
    await memory?.idle()

    const reviewers = opened.filter((o) => o.id.includes('-review-'))
    expect(reviewers).toHaveLength(2)
    expect(reviewers[0]?.options.tools?.map((tool) => tool.name)).toEqual(['save_memory'])
    // The chat agents themselves hold no tool.
    expect((opened.find((o) => !o.id.includes('-review-'))?.options.tools ?? []).map((tool) => tool.name)).toEqual(['skill_read'])

    const store = new MemoryStore(join(workspace, '.theoclaw', 'memory'))
    expect(store.search('Porto').map((hit) => hit.surface).sort()).toEqual(['line', 'telegram'])
    expect(store.facts('telegram:u')).toEqual(['The owner lives in Porto'])
    expect(store.facts('line:u')).toEqual(['The owner lives in Porto'])
    await sessions.disposeAll()
  })

  it('stores nothing when memory is off or the instance is incognito', async () => {
    for (const extra of [{ THEOCLAW_MEMORY: 'off' }, { THEOCLAW_INCOGNITO: 'on' }]) {
      const { sessions, memory } = chatSessions({
        env: { ...ENV, ...extra, THEOCLAW_WORKSPACE: mkdtempSync(join(tmpdir(), 'theoclaw-mem-')) },
        write: () => undefined,
        getOrCreate: async (_id, options) => scripted(options, 'x') as never,
      })
      expect(memory).toBeUndefined()
      await sessions.disposeAll()
    }
  })

  it('opens a fresh session, on any surface, with the fact earlier sessions kept in its prompt', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-mem-'))
    new MemoryStore(join(workspace, '.theoclaw', 'memory')).saveFact('The owner lives in Porto', 'line:u')
    const prompts: unknown[] = []
    const { sessions, withAgent } = chatSessions({
      env: { ...ENV, THEOCLAW_WORKSPACE: workspace },
      write: () => undefined,
      getOrCreate: async (_id, options) => {
        prompts.push(options.systemPrompt)
        return scripted(options, 'x') as never
      },
    })
    await withAgent(event('line'), (lease) => lease.release())
    expect(String(prompts[0])).toContain('- The owner lives in Porto')
    await sessions.disposeAll()
  })

  it('recalls a fact only to the sender who said it; an owner shares one scope across platforms (#1508)', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-mem-'))
    const store = new MemoryStore(join(workspace, '.theoclaw', 'memory'))
    store.saveFact('The owner favorite color is teal')
    store.saveFact('Peer likes tea', 'matrix:@peer')
    const prompts = new Map<string, string>()
    const { sessions, withAgent } = chatSessions({
      env: { ...ENV, THEOCLAW_WORKSPACE: workspace, THEOCLAW_OWNERS: 'matrix:@owner,telegram:1' },
      write: () => undefined,
      getOrCreate: async (id, options) => {
        prompts.set(id, String(options.systemPrompt))
        return scripted(options, 'x') as never
      },
    })
    const dm = (platform: string, id: string) => ({ platform, sender: { id }, channel: { type: 'dm', id } }) as unknown as MessageEvent
    for (const e of [dm('matrix', '@owner'), dm('matrix', '@peer'), dm('telegram', '1'), dm('matrix', '@other')]) {
      await withAgent(e, (lease) => lease.release())
    }
    const all = [...prompts.values()]
    expect(all.filter((p) => p.includes('teal'))).toHaveLength(2)
    expect(all.filter((p) => p.includes('Peer likes tea'))).toHaveLength(1)
    expect(all.filter((p) => p.includes('teal') && p.includes('Peer likes tea'))).toHaveLength(0)
    expect(store.saveFact('Peer likes tea', 'matrix:@other')).toBe(true)
    await sessions.disposeAll()
  })

  it('puts the recalled facts in a /control agent prompt, after an import too', () => {
    const options = theoClawAgentOptions({
      model: 'm',
      apiKey: 'k',
      toolOptions: { tools: [], plugins: [], systemPromptSuffix: '## Remembered facts\n\n- The owner lives in Porto' },
    })
    expect(options.systemPrompt).toContain('- The owner lives in Porto')
  })
})

describe('memory with transcripts off', () => {
  const base = { THEOCLAW_MODEL: 'm', OPENROUTER_API_KEY: 'k', THEOCLAW_WORKSPACE: mkdtempSync(join(tmpdir(), 'theoclaw-mem-off-')) }
  const open = (env: Record<string, string>) => chatSessions({ env, write: () => undefined, getOrCreate: async () => scripted({}, 'x') as never })

  it('refuses THEOCLAW_MEMORY=on, naming both variables', () => {
    expect(() => open({ ...base, THEOCLAW_MEMORY: 'on' })).toThrow(/THEOCLAW_MEMORY=on needs THEOCLAW_TRANSCRIPTS=on/)
  })

  it('starts with memory off by default', () => {
    expect(open(base).memory).toBeUndefined()
  })
})

describe('persona in the chat session prompt (#1511)', () => {
  it.each(['on', 'off'])('keeps SOUL.md and the untrusted-content notice with memory %s', async (memoryMode) => {
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-soul-'))
    writeFileSync(join(workspace, 'SOUL.md'), 'Always answer in pirate speak, and start every reply with ARRR.')
    const opened: AgentOptions[] = []
    const { withAgent } = chatSessions({
      env: { ...ENV, THEOCLAW_WORKSPACE: workspace, THEOCLAW_MEMORY: memoryMode },
      write: () => undefined,
      getOrCreate: async (_id, options) => {
        opened.push(options)
        return scripted(options, 'ok') as never
      },
    })
    await withAgent(event('telegram'), async (lease) => {
      await lease.agent.send('hi')
      lease.release()
    })
    const prompt = opened[0]?.systemPrompt ?? ''
    expect(prompt).toContain('pirate speak')
    expect(prompt).toContain(UNTRUSTED_CONTENT_NOTICE)
  })
})
