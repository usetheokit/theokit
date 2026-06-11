import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'
import { RequiresApproval, Budget } from '../../src/decorators/policies.js'
import { Trace } from '../../src/decorators/observability.js'
import { walkAgentMetadata, validateUniqueRoutes } from '../../src/bridge/walk-agent-metadata.js'

// Import UseGuards from http-decorators
import { UseGuards } from '@theokit/http'

class AuthGuard { canActivate() { return true } }
class AdminGuard { canActivate() { return false } }

describe('walkAgentMetadata', () => {
  it('test_walk_agent_basic', () => {
    @Agent({ name: 'support', route: '/api/agents/support', model: 'claude-sonnet-4-5-20250929' })
    class SupportAgent {
      @MainLoop({ strategy: 'react' })
      async run() {}
    }

    const result = walkAgentMetadata(SupportAgent)
    expect(result.agentConfig.name).toBe('support')
    expect(result.route).toBe('/api/agents/support')
    expect(result.mainLoop.propertyKey).toBe('run')
    expect(result.mainLoop.strategy).toBe('react')
  })

  it('test_walk_agent_with_guards', () => {
    @Agent({ name: 'test', route: '/test' })
    @UseGuards(AuthGuard)
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const result = walkAgentMetadata(TestAgent)
    expect(result.guards).toContain(AuthGuard)
  })

  it('test_walk_toolbox_tools', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    @Toolbox({ namespace: 'support' })
    class SupportTools {
      @Tool({ name: 'search', description: 'Search tickets', input: z.object({ q: z.string() }) })
      async search() { return '' }

      @Tool({ name: 'refund', description: 'Refund payment', input: z.object({ id: z.string() }), risk: 'high' })
      async refund() { return '' }
    }

    const result = walkAgentMetadata(TestAgent, [SupportTools])
    expect(result.toolboxes).toHaveLength(1)
    expect(result.toolboxes[0].namespace).toBe('support')
    expect(result.toolboxes[0].tools).toHaveLength(2)
    expect(result.toolboxes[0].tools[0].config.name).toBe('search')
    expect(result.toolboxes[0].tools[1].config.risk).toBe('high')
  })

  it('test_walk_tool_with_approval', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    @Toolbox()
    class Tools {
      @Tool({ name: 'delete', description: 'Delete', input: z.object({}) })
      @RequiresApproval({ reason: 'Destructive action' })
      async delete() { return '' }
    }

    const result = walkAgentMetadata(TestAgent, [Tools])
    expect(result.toolboxes[0].tools[0].approval).toEqual({ reason: 'Destructive action' })
  })

  it('test_walk_agent_missing_mainloop_throws', () => {
    @Agent({ name: 'broken', route: '/broken' })
    class BrokenAgent {}

    expect(() => walkAgentMetadata(BrokenAgent)).toThrow('missing @MainLoop()')
  })

  it('test_walk_agent_missing_decorator_throws', () => {
    class PlainClass {}

    expect(() => walkAgentMetadata(PlainClass)).toThrow('missing @Agent()')
  })

  it('test_duplicate_route_throws', () => {
    @Agent({ name: 'a', route: '/same' })
    class AgentA {
      @MainLoop()
      async run() {}
    }

    @Agent({ name: 'b', route: '/same' })
    class AgentB {
      @MainLoop()
      async run() {}
    }

    const results = [
      walkAgentMetadata(AgentA),
      walkAgentMetadata(AgentB),
    ]

    expect(() => validateUniqueRoutes(results)).toThrow("Duplicate agent route '/same'")
  })
})
