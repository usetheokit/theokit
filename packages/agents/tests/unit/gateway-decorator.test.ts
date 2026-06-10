import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Gateway, getGatewayConfig, resolveSessionId } from '../../src/decorators/gateway.js'

describe('@Gateway decorator', () => {
  it('test_gateway_stores_platforms', () => {
    @Agent({ name: 'support', route: '/api/agents/support' })
    @Gateway({ platforms: ['telegram', 'discord', 'slack'] })
    class SupportAgent {
      @MainLoop()
      async run() {}
    }

    const config = getGatewayConfig(SupportAgent)
    expect(config).toBeDefined()
    expect(config!.platforms).toEqual(['telegram', 'discord', 'slack'])
  })

  it('test_gateway_defaults', () => {
    @Agent({ name: 'chat', route: '/chat' })
    @Gateway({ platforms: ['telegram'] })
    class ChatAgent {
      @MainLoop()
      async run() {}
    }

    const config = getGatewayConfig(ChatAgent)!
    expect(config.sessionStrategy).toBe('per-user')
    expect(config.typing).toBe(true)
  })

  it('test_gateway_custom_session_strategy', () => {
    @Agent({ name: 'group', route: '/group' })
    @Gateway({ platforms: ['discord'], sessionStrategy: 'per-channel', typing: false })
    class GroupAgent {
      @MainLoop()
      async run() {}
    }

    const config = getGatewayConfig(GroupAgent)!
    expect(config.sessionStrategy).toBe('per-channel')
    expect(config.typing).toBe(false)
  })

  it('test_gateway_all_platforms', () => {
    @Agent({ name: 'omni', route: '/omni' })
    @Gateway({
      platforms: ['telegram', 'discord', 'slack', 'whatsapp', 'teams', 'email', 'sms', 'mattermost', 'line', 'matrix'],
    })
    class OmniAgent {
      @MainLoop()
      async run() {}
    }

    expect(getGatewayConfig(OmniAgent)!.platforms).toHaveLength(10)
  })

  it('test_no_gateway_returns_undefined', () => {
    @Agent({ name: 'http-only', route: '/http' })
    class HttpAgent {
      @MainLoop()
      async run() {}
    }

    expect(getGatewayConfig(HttpAgent)).toBeUndefined()
  })
})

describe('resolveSessionId', () => {
  const sender = { id: 'user-123' }

  it('test_per_user_strategy', () => {
    const id = resolveSessionId('per-user', 'telegram', sender, { id: 'ch-1', type: 'dm' })
    expect(id).toBe('telegram-dm-user-123')
  })

  it('test_per_channel_strategy', () => {
    const id = resolveSessionId('per-channel', 'discord', sender, { id: 'ch-456', type: 'group' })
    expect(id).toBe('discord-grp-ch-456')
  })

  it('test_per_thread_strategy_with_topic', () => {
    const id = resolveSessionId('per-thread', 'slack', sender, { id: 'ch-1', type: 'thread', topicId: 'topic-99' })
    expect(id).toBe('slack-tpc-ch-1-topic-99')
  })

  it('test_per_thread_strategy_without_topic', () => {
    const id = resolveSessionId('per-thread', 'telegram', sender, { id: 'ch-1', type: 'thread' })
    expect(id).toBe('telegram-tpc-ch-1-main')
  })

  it('test_different_platforms_produce_different_ids', () => {
    const tg = resolveSessionId('per-user', 'telegram', sender, { id: 'ch-1', type: 'dm' })
    const dc = resolveSessionId('per-user', 'discord', sender, { id: 'ch-1', type: 'dm' })
    expect(tg).not.toBe(dc)
  })
})
