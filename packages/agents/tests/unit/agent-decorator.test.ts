import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Agent, getAgentConfig } from '../../src/decorators/agent.js'

describe('@Agent decorator', () => {
  it('test_agent_stores_config', () => {
    @Agent({ name: 'support', route: '/api/agents/support' })
    class SupportAgent {}

    const config = getAgentConfig(SupportAgent)
    expect(config).toBeDefined()
    expect(config!.name).toBe('support')
    expect(config!.route).toBe('/api/agents/support')
  })

  it('test_agent_defaults_stream_true', () => {
    @Agent({ name: 'chat', route: '/api/agents/chat' })
    class ChatAgent {}

    const config = getAgentConfig(ChatAgent)
    expect(config!.stream).toBe(true)
  })

  it('test_agent_with_all_options', () => {
    @Agent({
      name: 'research',
      route: '/api/agents/research',
      model: 'claude-sonnet-4-5-20250929',
      stream: false,
      maxIterations: 10,
      timeoutMs: 30_000,
      systemPrompt: 'You are a research agent.',
    })
    class ResearchAgent {}

    const config = getAgentConfig(ResearchAgent)
    expect(config!.model).toBe('claude-sonnet-4-5-20250929')
    expect(config!.stream).toBe(false)
    expect(config!.maxIterations).toBe(10)
    expect(config!.timeoutMs).toBe(30_000)
    expect(config!.systemPrompt).toBe('You are a research agent.')
  })

  it('test_no_agent_returns_undefined', () => {
    class PlainClass {}
    expect(getAgentConfig(PlainClass)).toBeUndefined()
  })
})
