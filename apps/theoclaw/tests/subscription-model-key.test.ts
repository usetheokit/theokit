import { describe, expect, it } from 'vitest'

import { agentOptionsFor, webchatAgentFactory, type CreateAgent } from '../src/control-plane/agent-factory.js'
import { readControlPlaneSettings, requireModel } from '../src/control-plane/settings.js'
import type { TurnAgent } from '../src/control-plane/turn.js'

const SUBSCRIPTION = 'openai-chatgpt/gpt-5.6-luna'
const unused: TurnAgent = { send: () => Promise.reject(new Error('not used')) }

describe('the ChatGPT subscription route without an API key', () => {
  const env = { THEOCLAW_MODEL: SUBSCRIPTION, THEOCLAW_PORT: '0' }

  it('passes the start settings', () => {
    expect(readControlPlaneSettings(env as never).model).toBe(SUBSCRIPTION)
  })

  it('builds a WebChat agent with the keyless sentinel, not a credential', async () => {
    const seen: Array<{ model: string; apiKey: string }> = []
    const create: CreateAgent = async (options) => {
      seen.push({ model: options.model, apiKey: options.apiKey })
      return unused
    }
    await webchatAgentFactory(env as never, create)()
    expect(seen).toEqual([{ model: SUBSCRIPTION, apiKey: 'local' }])
    expect(agentOptionsFor(env as never).apiKey).toBe('local')
  })

  it('still passes a configured key through', () => {
    expect(requireModel({ ...env, OPENROUTER_API_KEY: 'k' } as never).modelKey).toBe('k')
  })

  it('still refuses other providers without a key', () => {
    expect(() => requireModel({ THEOCLAW_MODEL: 'openai-codex/gpt-5' } as never)).toThrow(/THEOKIT_API_KEY/)
  })
})

describe('the real SDK on the keyless sentinel', () => {
  it('builds the openai-chatgpt agent', async () => {
    const { createTheoClawAgent } = await import('../src/agent/create-agent.js')
    const agent = await createTheoClawAgent(agentOptionsFor({ THEOCLAW_MODEL: SUBSCRIPTION } as never))
    expect(agent).toBeDefined()
  })
})
