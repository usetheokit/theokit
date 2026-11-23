import { describe, expect, it } from 'vitest'

import type { TurnAgent } from '../src/agent-port.js'
import { createAgentFactory, type CreateAgent } from '../src/control-plane/agent-factory.js'
import { parseFallbackModel, parseThinkingLevel } from '../src/agent/create-agent.js'

describe('provider settings', () => {
  it('reads the thinking level and the fallback model', () => {
    expect(parseThinkingLevel(undefined)).toBeUndefined()
    expect(parseThinkingLevel(' High ')).toBe('high')
    expect(() => parseThinkingLevel('max')).toThrow('THEOCLAW_THINKING')
    expect(parseFallbackModel('  ')).toBeUndefined()
    expect(parseFallbackModel(' b/model ')).toBe('b/model')
  })
})

describe('model fallback wiring (OC-47)', () => {
  const primary: TurnAgent = { send: async () => ({ stream: async function* () {}, wait: async () => ({ status: 'finished' }), cancel: async () => {} }) }

  it('hands the fallback model to the SDK as modelFallback, with the thinking level, on one agent', async () => {
    const built: Array<{ model: string; thinking?: string; modelFallback?: unknown }> = []
    const create: CreateAgent = async (options) => {
      built.push({ model: options.model, ...(options.thinking === undefined ? {} : { thinking: options.thinking }), modelFallback: options.modelFallback })
      return primary
    }
    const env = { THEOCLAW_MODEL: 'a', THEOCLAW_MODEL_FALLBACK: 'b', THEOCLAW_THINKING: 'high', OPENROUTER_API_KEY: 'k' }
    const agent = await createAgentFactory(env, create)()
    expect(agent).toBe(primary)
    expect(built).toEqual([{ model: 'a', thinking: 'high', modelFallback: { models: ['b'] } }])
  })

  it('sets no modelFallback without a fallback, or when it names the primary', async () => {
    const seen: unknown[] = []
    const create: CreateAgent = async (options) => (seen.push(options.modelFallback), primary)
    await createAgentFactory({ THEOCLAW_MODEL: 'a', OPENROUTER_API_KEY: 'k' }, create)()
    await createAgentFactory({ THEOCLAW_MODEL: 'a', THEOCLAW_MODEL_FALLBACK: 'a', OPENROUTER_API_KEY: 'k' }, create)()
    expect(seen).toEqual([undefined, undefined])
  })
})
