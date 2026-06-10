import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { compileTools, compileAgent } from '../../src/bridge/agent-compiler.js'

describe('Agent compiler', () => {
  describe('compileTools', () => {
    it('test_compile_single_tool', () => {
      @Toolbox({ namespace: 'support' })
      class SupportTools {
        @Tool({ name: 'search', description: 'Search tickets', input: z.object({ q: z.string() }) })
        async search(input: { q: string }) { return `found: ${input.q}` }
      }

      @Agent({ name: 'test', route: '/test' })
      class TestAgent {
        @MainLoop()
        async run() {}
      }

      const result = walkAgentMetadata(TestAgent, [SupportTools])
      const instance = new SupportTools()
      const tools = compileTools(result.toolboxes, new Map([[SupportTools, instance]]))

      expect(tools).toHaveLength(1)
      expect(tools[0].name).toBe('support.search')
      expect(tools[0].description).toBe('Search tickets')
    })

    it('test_compile_namespaced_tools', () => {
      @Toolbox({ namespace: 'billing' })
      class BillingTools {
        @Tool({ name: 'charge', description: 'Charge', input: z.object({}) })
        async charge() { return 'charged' }

        @Tool({ name: 'refund', description: 'Refund', input: z.object({}) })
        async refund() { return 'refunded' }
      }

      @Agent({ name: 'test', route: '/test' })
      class TestAgent {
        @MainLoop()
        async run() {}
      }

      const result = walkAgentMetadata(TestAgent, [BillingTools])
      const tools = compileTools(result.toolboxes, new Map([[BillingTools, new BillingTools()]]))

      expect(tools.map(t => t.name)).toEqual(['billing.charge', 'billing.refund'])
    })

    it('test_handler_bound_to_instance', async () => {
      class DB { query() { return 'db-result' } }

      @Toolbox()
      class Tools {
        db = new DB()

        @Tool({ name: 'lookup', description: 'Lookup', input: z.object({}) })
        async lookup() { return this.db.query() }
      }

      @Agent({ name: 'test', route: '/test' })
      class TestAgent {
        @MainLoop()
        async run() {}
      }

      const instance = new Tools()
      const result = walkAgentMetadata(TestAgent, [Tools])
      const tools = compileTools(result.toolboxes, new Map([[Tools, instance]]))

      // Handler preserves `this` context — accesses instance.db
      const output = await tools[0].handler({})
      expect(output).toBe('db-result')
    })

    it('test_compile_missing_toolbox_instance_throws', () => {
      @Toolbox()
      class MissingTools {
        @Tool({ name: 'x', description: 'X', input: z.object({}) })
        async x() { return '' }
      }

      @Agent({ name: 'test', route: '/test' })
      class TestAgent {
        @MainLoop()
        async run() {}
      }

      const result = walkAgentMetadata(TestAgent, [MissingTools])
      // Empty instances map — EC-3
      expect(() => compileTools(result.toolboxes, new Map())).toThrow('not instantiated')
    })

    it('test_compile_tool_empty_schema', () => {
      @Toolbox()
      class Tools {
        @Tool({ name: 'ping', description: 'Ping', input: z.object({}) })
        async ping() { return 'pong' }
      }

      @Agent({ name: 'test', route: '/test' })
      class TestAgent {
        @MainLoop()
        async run() {}
      }

      const result = walkAgentMetadata(TestAgent, [Tools])
      const tools = compileTools(result.toolboxes, new Map([[Tools, new Tools()]]))
      expect(tools[0].inputSchema).toBeDefined()
    })
  })

  describe('compileAgent', () => {
    it('test_compile_agent_basic', () => {
      @Agent({ name: 'chat', route: '/chat', model: 'gpt-4o', systemPrompt: 'You are helpful.' })
      class ChatAgent {
        @MainLoop({ strategy: 'simple-chat' })
        async run() {}
      }

      const result = walkAgentMetadata(ChatAgent)
      const options = compileAgent(result)

      expect(options.model).toBe('gpt-4o')
      expect(options.systemPrompt).toBe('You are helpful.')
      expect(options.stream).toBe(true)
      expect(options.tools).toEqual([])
    })

    it('test_compile_agent_with_tools', () => {
      @Agent({ name: 'test', route: '/test' })
      class TestAgent {
        @MainLoop()
        async run() {}
      }

      @Toolbox({ namespace: 'ns' })
      class Tools {
        @Tool({ name: 'a', description: 'A', input: z.object({}) })
        async a() { return '' }
      }

      const result = walkAgentMetadata(TestAgent, [Tools])
      const options = compileAgent(result, new Map([[Tools, new Tools()]]))

      expect(options.tools).toHaveLength(1)
      expect(options.tools[0].name).toBe('ns.a')
    })

    it('test_compile_agent_no_tools', () => {
      @Agent({ name: 'pure-chat', route: '/chat', stream: false })
      class PureChatAgent {
        @MainLoop()
        async run() {}
      }

      const result = walkAgentMetadata(PureChatAgent)
      const options = compileAgent(result)

      expect(options.tools).toEqual([]) // EC-7
      expect(options.stream).toBe(false)
    })
  })
})
