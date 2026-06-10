import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Agent, getAgentConfig } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'
import { SubAgents, getSubAgents } from '../../src/decorators/sub-agents.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { compileAgent, compileSubAgents } from '../../src/bridge/agent-compiler.js'
import { generateAgentManifest } from '../../src/manifest/agent-manifest.js'

// ─── Sub-agents ─────────────────────────────────────────────

@Agent({ name: 'researcher', route: '/api/agents/researcher', model: 'claude-opus-4-6', systemPrompt: 'You research topics deeply.' })
class ResearchAgent {
  @MainLoop({ strategy: 'plan-act-reflect', maxIterations: 10 })
  async run() {}
}

@Agent({ name: 'coder', route: '/api/agents/coder', model: 'claude-sonnet-4-5-20250929', systemPrompt: 'You write code.' })
class CoderAgent {
  @MainLoop()
  async run() {}
}

@Agent({ name: 'reviewer', route: '/api/agents/reviewer', systemPrompt: 'You review code.' })
class ReviewerAgent {
  @MainLoop()
  async run() {}
}

describe('@SubAgents decorator', () => {
  it('test_subagents_stores_classes', () => {
    @Agent({ name: 'orchestrator', route: '/api/agents/orchestrator' })
    @SubAgents([ResearchAgent, CoderAgent])
    class OrchestratorAgent {
      @MainLoop()
      async run() {}
    }

    const subs = getSubAgents(OrchestratorAgent)
    expect(subs).toHaveLength(2)
    expect(subs).toContain(ResearchAgent)
    expect(subs).toContain(CoderAgent)
  })

  it('test_subagents_empty_returns_empty_array', () => {
    @Agent({ name: 'solo', route: '/solo' })
    class SoloAgent {
      @MainLoop()
      async run() {}
    }

    expect(getSubAgents(SoloAgent)).toEqual([])
  })

  it('test_subagents_validates_agent_decorator', () => {
    class NotAnAgent {}

    expect(() => {
      @Agent({ name: 'bad', route: '/bad' })
      @SubAgents([NotAnAgent])
      class BadOrchestrator {
        @MainLoop()
        async run() {}
      }
    }).toThrow('missing @Agent() decorator')
  })

  it('test_subagents_three_levels', () => {
    @Agent({ name: 'top', route: '/top' })
    @SubAgents([ResearchAgent, CoderAgent, ReviewerAgent])
    class TopAgent {
      @MainLoop()
      async run() {}
    }

    expect(getSubAgents(TopAgent)).toHaveLength(3)
  })
})

describe('compileSubAgents', () => {
  it('test_compiles_to_sdk_agents_map', () => {
    const result = compileSubAgents([ResearchAgent, CoderAgent])

    expect(result).toEqual({
      researcher: {
        model: 'claude-opus-4-6',
        systemPrompt: 'You research topics deeply.',
      },
      coder: {
        model: 'claude-sonnet-4-5-20250929',
        systemPrompt: 'You write code.',
      },
    })
  })

  it('test_compiles_empty_subagents', () => {
    expect(compileSubAgents([])).toEqual({})
  })

  it('test_subagent_without_model_has_undefined', () => {
    const result = compileSubAgents([ReviewerAgent])
    expect(result.reviewer.model).toBeUndefined()
    expect(result.reviewer.systemPrompt).toBe('You review code.')
  })
})

describe('walkAgentMetadata with sub-agents', () => {
  it('test_walk_collects_subagent_classes', () => {
    @Agent({ name: 'orch', route: '/orch' })
    @SubAgents([ResearchAgent, CoderAgent])
    class OrchAgent {
      @MainLoop()
      async run() {}
    }

    const result = walkAgentMetadata(OrchAgent)
    expect(result.subAgentClasses).toHaveLength(2)
    expect(result.subAgentClasses).toContain(ResearchAgent)
  })

  it('test_walk_no_subagents_returns_empty', () => {
    @Agent({ name: 'plain', route: '/plain' })
    class PlainAgent {
      @MainLoop()
      async run() {}
    }

    const result = walkAgentMetadata(PlainAgent)
    expect(result.subAgentClasses).toEqual([])
  })
})

describe('compileAgent with sub-agents', () => {
  it('test_compile_includes_agents_map', () => {
    @Agent({ name: 'orch', route: '/orch', model: 'claude-opus-4-6' })
    @SubAgents([ResearchAgent, CoderAgent])
    class OrchAgent {
      @MainLoop({ strategy: 'plan-act-reflect' })
      async run() {}
    }

    const result = walkAgentMetadata(OrchAgent)
    const compiled = compileAgent(result)

    expect(compiled.agents).toEqual({
      researcher: { model: 'claude-opus-4-6', systemPrompt: 'You research topics deeply.' },
      coder: { model: 'claude-sonnet-4-5-20250929', systemPrompt: 'You write code.' },
    })
    expect(compiled.model).toBe('claude-opus-4-6')
    expect(compiled.tools).toEqual([])
  })

  it('test_compile_agent_no_subagents_has_empty_map', () => {
    @Agent({ name: 'solo', route: '/solo' })
    class SoloAgent {
      @MainLoop()
      async run() {}
    }

    const compiled = compileAgent(walkAgentMetadata(SoloAgent))
    expect(compiled.agents).toEqual({})
  })
})

describe('manifest with sub-agents', () => {
  it('test_manifest_lists_subagent_names', () => {
    @Agent({ name: 'orch', route: '/orch' })
    @SubAgents([ResearchAgent, CoderAgent])
    class OrchAgent {
      @MainLoop()
      async run() {}
    }

    const result = walkAgentMetadata(OrchAgent)
    const manifest = generateAgentManifest([result])

    expect(manifest.agents[0].subAgents).toEqual(['ResearchAgent', 'CoderAgent'])
  })

  it('test_manifest_no_subagents_empty_array', () => {
    @Agent({ name: 'solo', route: '/solo' })
    class SoloAgent {
      @MainLoop()
      async run() {}
    }

    const manifest = generateAgentManifest([walkAgentMetadata(SoloAgent)])
    expect(manifest.agents[0].subAgents).toEqual([])
  })
})
