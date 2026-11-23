import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MessageEvent } from '@theokit/gateway'
import { listMemoryFacts, type AgentOptions } from '@theokit/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MemoryStore } from '../src/memory/memory-store.js'
import { userIdOf } from '../src/memory/wiring.js'
import { theoClawAgentOptions } from '../src/agent/create-agent.js'
import { chatSessions } from '../src/sessions/chat-sessions.js'
import { dm as dmEvent, say, seen } from './memory-sdk-support.js'

const ENV = { THEOCLAW_MODEL: 'm', OPENROUTER_API_KEY: 'k', THEOCLAW_TRANSCRIPTS: 'on' }
const event = (platform: string) =>
  ({ platform, sender: { id: 'u' }, channel: { type: 'dm', id: 'u' } }) as unknown as MessageEvent

/** A scripted agent that answers `answer`. */
function scripted(_options: AgentOptions, answer: string) {
  return {
    send: async () => ({
      stream: async function* () {},
      wait: async () => ({ status: 'finished', result: answer }),
      cancel: async () => undefined,
    }),
    dispose: async () => undefined,
  }
}

const stateOf = () => mkdtempSync(join(tmpdir(), 'theoclaw-state-'))
const memoryOf = (options: AgentOptions) =>
  options.memory as {
    enabled: boolean
    directory: string
    userId: string
    review?: { after: string }
    mirror?: unknown
  }
const dm = dmEvent

afterEach(() => vi.unstubAllEnvs())

describe('memory wired into the chat sessions (OC-56, Hermes row 3)', () => {
  it('stores a turn per surface and gives each session SDK memory with post-turn review, outside the cwd', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-mem-'))
    const state = stateOf()
    const opened: { id: string; options: AgentOptions }[] = []
    const { sessions, withAgent } = chatSessions({
      env: { ...ENV, THEOCLAW_WORKSPACE: workspace, THEOCLAW_STATE_DIR: state },
      write: () => undefined,
      getOrCreate: async (id, options) => {
        opened.push({ id, options })
        return scripted(options, 'noted') as never
      },
    })
    for (const platform of ['telegram', 'line']) {
      await withAgent(event(platform), async (lease) => {
        const run = await lease.agent.send(`I live in Porto (${platform})`)
        await run.wait()
        lease.release()
      })
    }
    // No reviewer fork: the SDK reviews each finished turn itself.
    expect(opened).toHaveLength(2)
    for (const { options } of opened) {
      expect(memoryOf(options)).toMatchObject({
        enabled: true,
        directory: join(state, 'memory'),
        review: { after: 'turn' },
      })
      expect((options.tools ?? []).map((tool) => tool.name)).toEqual(['skill_read'])
    }
    expect(
      new MemoryStore(join(state, 'memory'))
        .search('Porto')
        .map((hit) => hit.surface)
        .sort(),
    ).toEqual(['line', 'telegram'])
    // Memory writes nothing under the agent's cwd.
    expect(existsSync(join(workspace, '.theoclaw', 'memory'))).toBe(false)
    expect(memoryOf(opened[0]!.options).directory.startsWith(workspace)).toBe(false)
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

  it('gives a fresh session, on any surface, the same SDK store, which injects the facts earlier sessions kept', async () => {
    const state = stateOf()
    const seen: AgentOptions[] = []
    const { sessions, withAgent } = chatSessions({
      env: {
        ...ENV,
        THEOCLAW_WORKSPACE: mkdtempSync(join(tmpdir(), 'theoclaw-mem-')),
        THEOCLAW_STATE_DIR: state,
      },
      write: () => undefined,
      getOrCreate: async (_id, options) => {
        seen.push(options)
        return scripted(options, 'x') as never
      },
    })
    await withAgent(dm('line', 'u'), (lease) => lease.release())
    expect(memoryOf(seen[0]!)).toMatchObject({ enabled: true, directory: join(state, 'memory') })
    await sessions.disposeAll()
  })

  it(
    'opens a fresh session, on any surface, with the fact earlier sessions kept in its prompt',
    { timeout: 60_000 },
    async () => {
      const state = stateOf()
      const owners = { THEOCLAW_OWNERS: 'telegram:u,line:u' }
      const saving = await say(state, 'telegram', 'u', true, owners)
      const next = await say(state, 'line', 'u', false, owners)
      try {
        expect(JSON.stringify(next.requests[0])).toContain('Quillon-7731')
      } finally {
        await Promise.all([saving.close(), next.close()])
      }
    },
  )

  it('recalls a fact only to the sender who said it; an owner shares one scope across platforms (#1508)', async () => {
    const memories = new Map<string, string>()
    const { sessions, withAgent } = chatSessions({
      env: {
        ...ENV,
        THEOCLAW_WORKSPACE: mkdtempSync(join(tmpdir(), 'theoclaw-mem-')),
        THEOCLAW_STATE_DIR: stateOf(),
        THEOCLAW_OWNERS: 'matrix:@owner,telegram:1',
      },
      write: () => undefined,
      getOrCreate: async (id, options) => {
        memories.set(id, memoryOf(options).userId)
        return scripted(options, 'x') as never
      },
    })
    for (const e of [
      dm('matrix', '@owner'),
      dm('matrix', '@peer'),
      dm('telegram', '1'),
      dm('matrix', '@other'),
    ]) {
      await withAgent(e, (lease) => lease.release())
    }
    const ids = [...memories.values()]
    // The two owner identities share the owner partition; each other sender has a partition of its own.
    expect(ids.filter((id) => id === 'owner')).toHaveLength(2)
    expect(new Set(ids).size).toBe(3)
    expect(ids.filter((id) => id !== 'owner').every((id) => id !== 'owner')).toBe(true)
    await sessions.disposeAll()
  })

  it(
    'never recalls a fact saved for one DM sender to another, through the real SDK memory (#1834)',
    { timeout: 60_000 },
    async () => {
      const state = stateOf()
      const saving = await say(state, 'telegram', 'alice', true)
      const same = await say(state, 'telegram', 'alice', false)
      const other = await say(state, 'telegram', 'bob', false)
      const otherPlatform = await say(state, 'line', 'alice', false)
      try {
        expect(saving.requests.length).toBeGreaterThanOrEqual(3)
        expect(seen(same)).toContain('Quillon-7731')
        expect(seen(other)).not.toContain('Quillon-7731')
        expect(seen(otherPlatform)).not.toContain('Quillon-7731')
      } finally {
        await Promise.all([saving.close(), same.close(), other.close(), otherPlatform.close()])
      }
    },
  )

  it(
    'carries facts an earlier version kept under the workspace into the SDK partition of their scope (#1834)',
    { timeout: 60_000 },
    async () => {
      const state = stateOf()
      const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-legacy-'))
      mkdirSync(join(workspace, '.theoclaw', 'memory'), { recursive: true })
      const rows = [
        { fact: 'Legacy owner fact Zorblax-1', scope: 'owner' },
        { fact: 'Legacy unscoped fact Zorblax-2' },
        { fact: 'Legacy alice fact Zorblax-3', scope: 'telegram:alice' },
      ]
      writeFileSync(
        join(workspace, '.theoclaw', 'memory', 'facts.jsonl'),
        `${rows.map((row) => JSON.stringify(row)).join('\n')}\n{torn`,
      )
      const extra = { THEOCLAW_WORKSPACE: workspace }
      const alice = await say(state, 'telegram', 'alice', false, extra)
      const aliceAgain = await say(state, 'telegram', 'alice', false, extra)
      const bob = await say(state, 'telegram', 'bob', false, extra)
      const owner = await say(state, 'telegram', 'boss', false, {
        ...extra,
        THEOCLAW_OWNERS: 'telegram:boss',
      })
      try {
        expect(seen(alice)).toContain('Zorblax-3')
        expect(seen(alice)).not.toContain('Zorblax-1')
        expect(seen(aliceAgain).split('Zorblax-3').length).toBe(
          seen(alice).split('Zorblax-3').length,
        )
        expect(seen(bob)).not.toContain('Zorblax')
        expect(seen(owner)).toContain('Zorblax-1')
        expect(seen(owner)).toContain('Zorblax-2')
        expect(seen(owner)).not.toContain('Zorblax-3')
      } finally {
        await Promise.all([alice.close(), aliceAgain.close(), bob.close(), owner.close()])
      }
    },
  )

  it('lets two sessions of one scope that open together both start with the carried facts (#1834)', async () => {
    const state = stateOf()
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-legacy-'))
    mkdirSync(join(workspace, '.theoclaw', 'memory'), { recursive: true })
    writeFileSync(
      join(workspace, '.theoclaw', 'memory', 'facts.jsonl'),
      `${JSON.stringify({ fact: 'Legacy race fact Plinth-9' })}\n`,
    )
    const atOpen: string[][] = []
    const { sessions, withAgent } = chatSessions({
      env: {
        ...ENV,
        THEOCLAW_WORKSPACE: workspace,
        THEOCLAW_STATE_DIR: state,
        THEOCLAW_OWNERS: 'telegram:u,line:u',
      },
      write: () => undefined,
      getOrCreate: async (_id, options) => {
        const memory = memoryOf(options)
        atOpen.push((await listMemoryFacts(memory.directory, options.memory)).map((fact) => fact.text))
        return scripted(options, 'ok') as never
      },
    })
    await Promise.all(
      ['telegram', 'line'].map((platform) =>
        withAgent(event(platform), async (lease) => lease.release()),
      ),
    )
    await sessions.disposeAll()
    expect(atOpen).toEqual([['Legacy race fact Plinth-9'], ['Legacy race fact Plinth-9']])
  })

  it('never shares a partition between two senders, even ones that differ only in case or punctuation', () => {
    const scopes = [
      'telegram:1',
      'telegram:2',
      'matrix:@Alice',
      'matrix:@alice',
      'matrix:a-lice',
      'matrix:a.lice',
      'owner',
    ]
    const ids = scopes.map(userIdOf)
    expect(new Set(ids).size).toBe(scopes.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9][a-z0-9-_]*$/)
    expect(userIdOf('owner')).toBe('owner')
  })

  it('puts the recalled facts in a /control agent prompt, after an import too', () => {
    const options = theoClawAgentOptions({
      model: 'm',
      apiKey: 'k',
      toolOptions: {
        tools: [],
        plugins: [],
        systemPromptSuffix: '## Remembered facts\n\n- The owner lives in Porto',
      },
    })
    expect(options.systemPrompt).toContain('- The owner lives in Porto')
  })
})

describe('memory with transcripts off', () => {
  const base = {
    THEOCLAW_MODEL: 'm',
    OPENROUTER_API_KEY: 'k',
    THEOCLAW_WORKSPACE: mkdtempSync(join(tmpdir(), 'theoclaw-mem-off-')),
  }
  const open = (env: Record<string, string>) =>
    chatSessions({
      env,
      write: () => undefined,
      getOrCreate: async () => scripted({}, 'x') as never,
    })

  it('refuses THEOCLAW_MEMORY=on, naming both variables', () => {
    expect(() => open({ ...base, THEOCLAW_MEMORY: 'on' })).toThrow(
      /THEOCLAW_MEMORY=on needs THEOCLAW_TRANSCRIPTS=on/,
    )
  })

  it('starts with memory off by default', () => {
    expect(open(base).memory).toBeUndefined()
  })
})

describe('persona in the chat session prompt (#1511)', () => {
  it.each(['on', 'off'])(
    'keeps SOUL.md and the untrusted-content notice with memory %s',
    async (memoryMode) => {
      const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-soul-'))
      writeFileSync(
        join(workspace, 'SOUL.md'),
        'Always answer in pirate speak, and start every reply with ARRR.',
      )
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
      expect(prompt).not.toContain('<untrusted-tool-output>')
      expect(opened[0]?.sendDefaults?.toolResultGuard).toEqual({ delimit: true })
    },
  )
})

describe('memory block with the persona files in a new session prompt (#1731)', () => {
  it(
    'carries the saved fact, the standing order and SOUL.md together',
    { timeout: 60_000 },
    async () => {
      const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-all-'))
      writeFileSync(join(workspace, 'SOUL.md'), 'Always answer in pirate speak.')
      writeFileSync(join(workspace, 'STANDING-ORDERS.md'), 'Never discuss the weather.')
      const state = stateOf()
      const env = { THEOCLAW_WORKSPACE: workspace, THEOCLAW_OWNERS: 'telegram:v,line:v' }
      const saving = await say(state, 'telegram', 'v', true, env)
      const next = await say(state, 'line', 'v', false, env)
      try {
        const prompt = JSON.stringify(next.requests[0])
        for (const part of ['Quillon-7731', 'pirate speak', 'Never discuss the weather.'])
          expect(prompt).toContain(part)
      } finally {
        await Promise.all([saving.close(), next.close()])
      }
    },
  )

  it('opens the owner SDK memory with the standing order and SOUL.md in the prompt', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-all-'))
    writeFileSync(join(workspace, 'SOUL.md'), 'Always answer in pirate speak.')
    writeFileSync(join(workspace, 'STANDING-ORDERS.md'), 'Never discuss the weather.')
    const opened: AgentOptions[] = []
    const { withAgent } = chatSessions({
      env: {
        ...ENV,
        THEOCLAW_WORKSPACE: workspace,
        THEOCLAW_STATE_DIR: stateOf(),
        THEOCLAW_OWNERS: 'telegram:u,line:u',
      },
      write: () => undefined,
      getOrCreate: async (_id, options) => {
        opened.push(options)
        return scripted(options, 'ok') as never
      },
    })
    await withAgent(dm('line', 'u'), (lease) => lease.release())
    const prompt = String(opened[0]?.systemPrompt)
    expect(prompt).toContain('pirate speak')
    expect(prompt).toContain('Never discuss the weather.')
    expect(memoryOf(opened[0]!).userId).toBe('owner')
    expect(prompt).not.toContain('<untrusted-tool-output>')
    expect(opened[0]?.sendDefaults?.toolResultGuard).toEqual({ delimit: true })
  })
})
