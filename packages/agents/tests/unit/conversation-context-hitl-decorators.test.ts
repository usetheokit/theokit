import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'
import { Conversation, getConversationConfig } from '../../src/decorators/conversation.js'
import { ContextWindow, getContextWindowConfig } from '../../src/decorators/context-window.js'
import { HumanInTheLoop, getHumanInTheLoopConfig } from '../../src/decorators/human-in-the-loop.js'

// ─── @Conversation ──────────────────────────────────────────

describe('@Conversation decorator', () => {
  it('test_conversation_stores_config', () => {
    @Agent({ name: 'test', route: '/test' })
    @Conversation({ storage: 'drizzle', maxHistory: 100, compaction: 'summarize', ttl: 86_400_000 })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getConversationConfig(TestAgent)!
    expect(config.storage).toBe('drizzle')
    expect(config.maxHistory).toBe(100)
    expect(config.compaction).toBe('summarize')
    expect(config.ttl).toBe(86_400_000)
  })

  it('test_conversation_defaults', () => {
    @Agent({ name: 'test', route: '/test' })
    @Conversation()
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getConversationConfig(TestAgent)!
    expect(config.storage).toBe('memory')
    expect(config.maxHistory).toBe(0)
    expect(config.compaction).toBe('truncate')
    expect(config.ttl).toBe(0)
    expect(config.preserveLastN).toBe(5)
  })

  it('test_conversation_redis', () => {
    @Agent({ name: 'test', route: '/test' })
    @Conversation({ storage: 'redis', ttl: 3_600_000 })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getConversationConfig(TestAgent)!.storage).toBe('redis')
  })

  it('test_no_conversation_returns_undefined', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getConversationConfig(TestAgent)).toBeUndefined()
  })
})

// ─── @ContextWindow ─────────────────────────────────────────

describe('@ContextWindow decorator', () => {
  it('test_context_window_stores_config', () => {
    @Agent({ name: 'test', route: '/test' })
    @ContextWindow({
      maxTokens: 200_000,
      compactionStrategy: 'priority-based',
      preserveLastN: 20,
    })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getContextWindowConfig(TestAgent)!
    expect(config.maxTokens).toBe(200_000)
    expect(config.compactionStrategy).toBe('priority-based')
    expect(config.preserveLastN).toBe(20)
  })

  it('test_context_window_defaults', () => {
    @Agent({ name: 'test', route: '/test' })
    @ContextWindow()
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getContextWindowConfig(TestAgent)!
    expect(config.maxTokens).toBe(100_000)
    expect(config.compactionStrategy).toBe('summarize-oldest')
    expect(config.preserveSystemPrompt).toBe(true)
    expect(config.preserveLastN).toBe(10)
    expect(config.preserveToolResults).toBe(true)
  })

  it('test_context_window_sliding', () => {
    @Agent({ name: 'test', route: '/test' })
    @ContextWindow({ compactionStrategy: 'sliding-window', preserveLastN: 50 })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getContextWindowConfig(TestAgent)!
    expect(config.compactionStrategy).toBe('sliding-window')
    expect(config.preserveLastN).toBe(50)
  })

  it('test_no_context_window_returns_undefined', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getContextWindowConfig(TestAgent)).toBeUndefined()
  })
})

// ─── @HumanInTheLoop ────────────────────────────────────────

describe('@HumanInTheLoop decorator', () => {
  it('test_hitl_on_tool', () => {
    @Toolbox({ namespace: 'ops' })
    class OpsTools {
      @Tool({ name: 'deploy', description: 'Deploy to prod', input: z.object({}) })
      @HumanInTheLoop({ question: 'Confirm deployment?' })
      async deploy() { return '' }
    }

    const config = getHumanInTheLoopConfig(OpsTools, 'deploy')!
    expect(config.question).toBe('Confirm deployment?')
    expect(config.timeout).toBe(300_000) // default 5 min
    expect(config.onTimeout).toBe('abort') // default
    expect(config.showInput).toBe(true) // default
  })

  it('test_hitl_custom_timeout', () => {
    @Toolbox()
    class Tools {
      @Tool({ name: 'delete', description: 'Delete', input: z.object({}) })
      @HumanInTheLoop({
        question: 'Delete all data?',
        timeout: 60_000,
        onTimeout: 'retry',
        showInput: false,
      })
      async delete() { return '' }
    }

    const config = getHumanInTheLoopConfig(Tools, 'delete')!
    expect(config.timeout).toBe(60_000)
    expect(config.onTimeout).toBe('retry')
    expect(config.showInput).toBe(false)
  })

  it('test_hitl_proceed_on_timeout', () => {
    @Toolbox()
    class Tools {
      @Tool({ name: 'notify', description: 'Notify', input: z.object({}) })
      @HumanInTheLoop({ question: 'Send notification?', onTimeout: 'proceed' })
      async notify() { return '' }
    }

    expect(getHumanInTheLoopConfig(Tools, 'notify')!.onTimeout).toBe('proceed')
  })

  it('test_no_hitl_returns_undefined', () => {
    @Toolbox()
    class Tools {
      @Tool({ name: 'read', description: 'Read', input: z.object({}) })
      async read() { return '' }
    }

    expect(getHumanInTheLoopConfig(Tools, 'read')).toBeUndefined()
  })
})
