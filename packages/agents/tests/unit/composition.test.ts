import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Reflector, UseGuards } from '@theokit/http'
import { Agent, getAgentConfig } from '../../src/decorators/agent.js'
import { MainLoop, getMainLoop } from '../../src/decorators/main-loop.js'
import { Toolbox, Tool, getToolMethods, getToolConfig } from '../../src/decorators/tool.js'
import { Budget } from '../../src/decorators/policies.js'
import { Trace } from '../../src/decorators/observability.js'
import { Memory, getMemoryConfig } from '../../src/decorators/memory.js'
import { Throttle, getThrottleOptions } from '@theokit/http'
import { applyDecorators } from '../../src/decorators/apply-decorators.js'
import { Mixin, getMixins } from '../../src/decorators/mixin.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'

const reflector = new Reflector()

class AuthGuard { canActivate() { return true } }
class TenantGuard { canActivate() { return true } }

// ─── applyDecorators ───────────────────────────────────────

describe('applyDecorators — decorator composition', () => {
  it('test_compose_agent_preset', () => {
    const ProductionAgent = (name: string, route: string) => applyDecorators(
      Agent({ name, route, model: 'claude-sonnet-4-5-20250929' }),
      UseGuards(AuthGuard, TenantGuard),
      Memory({ provider: 'built-in', embeddings: true }),
      Trace(true),
    )

    @ProductionAgent('support', '/api/agents/support')
    class SupportAgent {
      @MainLoop()
      async run() {}
    }

    // All decorators applied
    const config = getAgentConfig(SupportAgent)!
    expect(config.name).toBe('support')
    expect(config.route).toBe('/api/agents/support')
    expect(config.model).toBe('claude-sonnet-4-5-20250929')

    const mem = getMemoryConfig(SupportAgent)!
    expect(mem.provider).toBe('built-in')
    expect(mem.embeddings).toBe(true)

    expect(reflector.get(Trace, SupportAgent)).toBe(true)
  })

  it('test_compose_reused_across_agents', () => {
    const ProductionAgent = (name: string, route: string) => applyDecorators(
      Agent({ name, route }),
      UseGuards(AuthGuard),
    )

    @ProductionAgent('a', '/a')
    class AgentA {
      @MainLoop()
      async run() {}
    }

    @ProductionAgent('b', '/b')
    class AgentB {
      @MainLoop()
      async run() {}
    }

    expect(getAgentConfig(AgentA)!.name).toBe('a')
    expect(getAgentConfig(AgentB)!.name).toBe('b')
  })

  it('test_compose_method_level_decorators', () => {
    const SecureTool = (name: string, desc: string) => applyDecorators(
      Tool({ name, description: desc, input: z.object({}) }),
      Trace(true),
    )

    @Toolbox({ namespace: 'ops' })
    class OpsTools {
      @SecureTool('deploy', 'Deploy to production')
      async deploy() { return '' }
    }

    const config = getToolConfig(OpsTools, 'deploy')!
    expect(config.name).toBe('deploy')
    expect(reflector.get(Trace, OpsTools, 'deploy')).toBe(true)
  })

  it('test_compose_can_be_extended', () => {
    const BaseAgent = (name: string, route: string) => applyDecorators(
      Agent({ name, route }),
      UseGuards(AuthGuard),
    )

    // Extend the base preset with more decorators
    @BaseAgent('extended', '/extended')
    @Memory({ provider: 'honcho' })
    class ExtendedAgent {
      @MainLoop()
      async run() {}
    }

    expect(getAgentConfig(ExtendedAgent)!.name).toBe('extended')
    expect(getMemoryConfig(ExtendedAgent)!.provider).toBe('honcho')
  })
})

// ─── @Mixin ─────────────────────────────────────────────────

describe('@Mixin — capability composition', () => {
  it('test_mixin_stores_classes', () => {
    class SearchCapability {
      @Tool({ name: 'search', description: 'Search', input: z.object({}) })
      async search() { return '' }
    }

    class FileCapability {
      @Tool({ name: 'read', description: 'Read', input: z.object({}) })
      async read() { return '' }
    }

    @Agent({ name: 'test', route: '/test' })
    @Mixin(SearchCapability, FileCapability)
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const mixins = getMixins(TestAgent)
    expect(mixins).toHaveLength(2)
    expect(mixins).toContain(SearchCapability)
    expect(mixins).toContain(FileCapability)
  })

  it('test_mixin_tools_accessible', () => {
    class CRMCapability {
      @Tool({ name: 'find_customer', description: 'Find customer', input: z.object({ id: z.string() }) })
      async findCustomer() { return '' }

      @Tool({ name: 'update_customer', description: 'Update customer', input: z.object({}) })
      async updateCustomer() { return '' }
    }

    @Agent({ name: 'support', route: '/support' })
    @Mixin(CRMCapability)
    class SupportAgent {
      @MainLoop()
      async run() {}
    }

    // Mixin class tools are readable
    const methods = getToolMethods(CRMCapability)
    expect(methods).toEqual(['findCustomer', 'updateCustomer'])

    // Mixin class is listed
    expect(getMixins(SupportAgent)).toContain(CRMCapability)
  })

  it('test_mixin_walkable_as_toolboxes', () => {
    @Toolbox({ namespace: 'crm' })
    class CRMTools {
      @Tool({ name: 'lookup', description: 'Lookup', input: z.object({}) })
      async lookup() { return '' }
    }

    @Agent({ name: 'support', route: '/support' })
    @Mixin(CRMTools)
    class SupportAgent {
      @MainLoop()
      async run() {}
    }

    // Mixins that are @Toolbox can be walked
    const mixins = getMixins(SupportAgent)
    const result = walkAgentMetadata(SupportAgent, mixins)
    expect(result.toolboxes).toHaveLength(1)
    expect(result.toolboxes[0].namespace).toBe('crm')
    expect(result.toolboxes[0].tools[0].config.name).toBe('lookup')
  })

  it('test_no_mixin_returns_empty', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getMixins(TestAgent)).toEqual([])
  })

  it('test_mixin_multiple_applications_accumulate', () => {
    class A {}
    class B {}
    class C {}

    @Agent({ name: 'test', route: '/test' })
    @Mixin(A, B)
    @Mixin(C)
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getMixins(TestAgent)).toHaveLength(3)
  })
})

// ─── Full composition example ───────────────────────────────

describe('Full composition — preset + mixin + override', () => {
  it('test_production_agent_with_shared_capabilities', () => {
    // 1. Shared capabilities
    @Toolbox({ namespace: 'search' })
    class SearchTools {
      @Tool({ name: 'web', description: 'Web search', input: z.object({ q: z.string() }) })
      async web() { return '' }
    }

    @Toolbox({ namespace: 'files' })
    class FileTools {
      @Tool({ name: 'read', description: 'Read file', input: z.object({ path: z.string() }) })
      async read() { return '' }
    }

    // 2. Preset decorator
    const ProductionAgent = (name: string, route: string) => applyDecorators(
      Agent({ name, route, model: 'claude-sonnet-4-5-20250929' }),
      UseGuards(AuthGuard),
      Memory({ provider: 'built-in' }),
      Trace(true),
    )

    // 3. Compose preset + mixins + local override
    @ProductionAgent('research', '/api/agents/research')
    @Mixin(SearchTools, FileTools)
    @Budget({ maxCostUsd: 10.00 })  // additional local decorator
    class ResearchAgent {
      @MainLoop({ strategy: 'plan-act-reflect', maxIterations: 15 })
      async run() {}
    }

    // Verify everything composed correctly
    const config = getAgentConfig(ResearchAgent)!
    expect(config.name).toBe('research')
    expect(config.model).toBe('claude-sonnet-4-5-20250929')

    const mem = getMemoryConfig(ResearchAgent)!
    expect(mem.provider).toBe('built-in')

    expect(reflector.get(Trace, ResearchAgent)).toBe(true)
    expect(reflector.get(Budget, ResearchAgent)).toEqual({ maxCostUsd: 10.00 })

    const mixins = getMixins(ResearchAgent)
    expect(mixins).toHaveLength(2)

    // Walk with mixins as toolboxes
    const result = walkAgentMetadata(ResearchAgent, mixins)
    expect(result.toolboxes).toHaveLength(2)
    expect(result.toolboxes[0].namespace).toBe('search')
    expect(result.toolboxes[1].namespace).toBe('files')
    expect(result.mainLoop.strategy).toBe('plan-act-reflect')
  })
})
