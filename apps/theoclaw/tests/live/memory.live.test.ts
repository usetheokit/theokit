import { randomInt } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Agent } from '@theokit/sdk'
import type { AgentOptions } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { createChannelAgentFactory } from '../../src/control-plane/agent-factory.js'
import { MemoryStore } from '../../src/memory/memory-store.js'
import { sessionSearchTool } from '../../src/memory/memory-tools.js'
import { chatSessions } from '../../src/sessions/chat-sessions.js'
import type { SessionAgent } from '../../src/sessions/session-agents.js'

/**
 * OC-56 and Hermes row 3 against a real model: a turn stored from one surface is returned by
 * `session_search` on another, and after a turn the forked reviewer saves a fact the next session
 * recalls. Runs only with THEOCLAW_LIVE=1 and the model settings in the environment; skips without
 * the flag so CI stays offline. With the flag and no model, it fails rather than skips.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const TURN_TIMEOUT_MS = 180_000

const word = (): string => Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(26))).join('')

describe.skipIf(!LIVE)('memory across surfaces and the per-turn review, live', () => {
  it(
    'session_search finds a Telegram session from the control surface, and the reviewer fact is recalled',
    async () => {
      const workspace = mkdtempSync(join(tmpdir(), 'theoclaw-mem-live-'))
      const city = word()
      const env = { ...process.env, THEOCLAW_WORKSPACE: workspace }
      const { sessions, withAgent, memory } = chatSessions({
        env,
        write: () => undefined,
        getOrCreate: (id: string, options: AgentOptions) => Agent.getOrCreate(id, options) as unknown as Promise<SessionAgent>,
      })
      const telegram = { platform: 'telegram', sender: { id: 'u' }, channel: { type: 'dm', id: 'u' } } as never
      await withAgent(telegram, async (lease) => {
        const run = await lease.agent.send(`Please remember: my home city is called ${city}. Reply "ok".`)
        for await (const message of run.stream()) void message
        await run.wait()
        lease.release()
      })
      await memory?.idle()
      await sessions.disposeAll()

      const store = new MemoryStore(join(workspace, '.theoclaw', 'memory'))
      // A fact the forked reviewer saved with a real model call.
      expect(store.facts().join(' ')).toContain(city)

      // A fresh session on another surface recalls the fact from its prompt alone: it has no tool.
      const other = chatSessions({
        env,
        write: () => undefined,
        getOrCreate: (id: string, options: AgentOptions) => Agent.getOrCreate(id, options) as unknown as Promise<SessionAgent>,
      })
      const line = { platform: 'line', sender: { id: 'u' }, channel: { type: 'dm', id: 'u' } } as never
      const recalled = await other.withAgent(line, async (lease) => {
        const run = await lease.agent.send('What is my home city called? Answer with just the name.')
        for await (const message of run.stream()) void message
        const result = await run.wait()
        lease.release()
        return result.result ?? ''
      })
      await other.memory?.idle()
      await other.sessions.disposeAll()
      expect(recalled).toContain(city)

      // A different surface (the control agent) asks session_search through a real model.
      const control = await createChannelAgentFactory(env, (options) =>
        Agent.create({ ...options, tools: [sessionSearchTool(store)] } as never),
      )()
      const run = await (control as unknown as { send(m: string): Promise<{ stream(): AsyncIterable<unknown>; wait(): Promise<{ result?: string }> }> }).send(
        'Use session_search to look up what my home city is called, and answer with just the name.',
      )
      for await (const message of run.stream()) void message
      expect((await run.wait()).result ?? '').toContain(city)
    },
    TURN_TIMEOUT_MS,
  )
})
