import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'
import { RequiresApproval } from '../../src/decorators/policies.js'
import { UseGuards } from '@theokit/http'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { generateAgentManifest } from '../../src/manifest/agent-manifest.js'

class AuthGuard { canActivate() { return true } }

describe('Agent manifest generation', () => {
  it('test_manifest_structure', () => {
    @Agent({ name: 'support', route: '/api/agents/support', model: 'claude-sonnet-4-5-20250929' })
    @UseGuards(AuthGuard)
    class SupportAgent {
      @MainLoop({ strategy: 'react' })
      async run() {}
    }

    @Toolbox({ namespace: 'support' })
    class SupportTools {
      @Tool({ name: 'search', description: 'Search tickets', input: z.object({}), risk: 'low' })
      async search() { return '' }
    }

    const result = walkAgentMetadata(SupportAgent, [SupportTools])
    const manifest = generateAgentManifest([result])

    expect(manifest.version).toBe('1.0')
    expect(manifest.agents).toHaveLength(1)
    expect(manifest.agents[0].name).toBe('support')
    expect(manifest.agents[0].route).toBe('/api/agents/support')
    expect(manifest.agents[0].model).toBe('claude-sonnet-4-5-20250929')
    expect(manifest.agents[0].stream).toBe(true)
    expect(manifest.agents[0].mainLoop).toEqual({ method: 'run', strategy: 'react' })
    expect(manifest.agents[0].guards).toEqual(['AuthGuard'])
    expect(manifest.agents[0].tools).toHaveLength(1)
  })

  it('test_manifest_tool_details', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    @Toolbox({ namespace: 'billing' })
    class BillingTools {
      @Tool({ name: 'refund', description: 'Refund payment', input: z.object({}), risk: 'high' })
      @RequiresApproval({ reason: 'Affects billing' })
      async refund() { return '' }
    }

    const result = walkAgentMetadata(TestAgent, [BillingTools])
    const manifest = generateAgentManifest([result])

    const tool = manifest.agents[0].tools[0]
    expect(tool.name).toBe('billing.refund')
    expect(tool.description).toBe('Refund payment')
    expect(tool.risk).toBe('high')
    expect(tool.approval).toBe(true)
  })

  it('test_manifest_serializable', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const result = walkAgentMetadata(TestAgent)
    const manifest = generateAgentManifest([result])

    // No circular refs, no Functions — JSON.stringify must succeed
    const json = JSON.stringify(manifest)
    expect(json).toBeDefined()
    const parsed = JSON.parse(json)
    expect(parsed.agents[0].name).toBe('test')
  })

  it('test_manifest_multiple_agents', () => {
    @Agent({ name: 'a', route: '/a' })
    class AgentA {
      @MainLoop()
      async run() {}
    }

    @Agent({ name: 'b', route: '/b' })
    class AgentB {
      @MainLoop()
      async run() {}
    }

    const results = [walkAgentMetadata(AgentA), walkAgentMetadata(AgentB)]
    const manifest = generateAgentManifest(results)

    expect(manifest.agents).toHaveLength(2)
    expect(manifest.agents.map(a => a.name)).toEqual(['a', 'b'])
  })
})
