import { describe, expect, it } from 'vitest'

import type { TurnAgent, TurnRun } from '../src/agent-port.js'
import { createAgentFactory, type CreateAgent } from '../src/control-plane/agent-factory.js'
import { parseFallbackModel, parseThinkingLevel, withFailover } from '../src/agent/failover.js'

function run(messages: string[], status: string): TurnRun {
  return {
    async *stream() {
      for (const type of messages) yield { type }
    },
    wait: async () => ({ status }),
    cancel: async () => {},
  }
}

async function drain(turn: TurnRun): Promise<string[]> {
  const seen: string[] = []
  for await (const item of turn.stream()) seen.push(item.type)
  return seen
}

describe('failover between providers (OC-47)', () => {
  it('a primary whose send throws falls over to the secondary in the same turn', async () => {
    const primary: TurnAgent = { send: () => Promise.reject(new Error('provider down')) }
    const secondary: TurnAgent = { send: async () => run(['assistant'], 'finished') }
    const turn = await withFailover(primary, async () => secondary).send('hi')
    expect(await drain(turn)).toEqual(['assistant'])
    expect((await turn.wait()).status).toBe('finished')
  })

  it('a primary run that fails with no output falls over, and the secondary result is the turn', async () => {
    const sent: unknown[] = []
    const primary: TurnAgent = { send: async () => run([], 'failed') }
    const secondary: TurnAgent = { send: async (message) => (sent.push(message), run(['assistant'], 'finished')) }
    const turn = await withFailover(primary, async () => secondary).send('hello')
    expect(await drain(turn)).toEqual(['assistant'])
    expect(sent).toEqual(['hello'])
    expect((await turn.wait()).status).toBe('finished')
  })

  it('a primary that already streamed stays the turn and the secondary is never built', async () => {
    let built = false
    const primary: TurnAgent = { send: async () => run(['assistant'], 'failed') }
    const turn = await withFailover(primary, async () => ((built = true), primary)).send('x')
    expect(await drain(turn)).toEqual(['assistant'])
    expect(built).toBe(false)
    expect((await turn.wait()).status).toBe('failed')
  })
})

describe('provider settings', () => {
  it('reads the thinking level and the fallback model', () => {
    expect(parseThinkingLevel(undefined)).toBeUndefined()
    expect(parseThinkingLevel(' High ')).toBe('high')
    expect(() => parseThinkingLevel('max')).toThrow('THEOCLAW_THINKING')
    expect(parseFallbackModel('  ')).toBeUndefined()
    expect(parseFallbackModel(' b/model ')).toBe('b/model')
  })
})

describe('failover wiring', () => {
  it('builds the secondary lazily with the fallback model and passes the thinking level', async () => {
    const built: Array<{ model: string; thinking?: string }> = []
    const create: CreateAgent = async (options) => {
      built.push({ model: options.model, ...(options.thinking === undefined ? {} : { thinking: options.thinking }) })
      return options.model === 'a' ? { send: () => Promise.reject(new Error('down')) } : { send: async () => run(['assistant'], 'finished') }
    }
    const env = { THEOCLAW_MODEL: 'a', THEOCLAW_MODEL_FALLBACK: 'b', THEOCLAW_THINKING: 'high', OPENROUTER_API_KEY: 'k' }
    const agent = await createAgentFactory(env, create)()
    expect(built).toEqual([{ model: 'a', thinking: 'high' }])
    expect(await drain(await agent.send('hi'))).toEqual(['assistant'])
    expect(built.map((entry) => entry.model)).toEqual(['a', 'b'])
  })

  it('with no fallback the primary agent is returned as is', async () => {
    const primary: TurnAgent = { send: async () => run([], 'finished') }
    const agent = await createAgentFactory({ THEOCLAW_MODEL: 'a', OPENROUTER_API_KEY: 'k' }, async () => primary)()
    expect(agent).toBe(primary)
  })
})
