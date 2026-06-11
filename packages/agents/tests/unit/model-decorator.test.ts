import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Reflector } from '@theokit/http'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'
import { Model } from '../../src/decorators/model.js'

const reflector = new Reflector()

describe('@Model decorator', () => {
  it('test_model_on_agent_class', () => {
    @Agent({ name: 'test', route: '/test' })
    @Model('claude-opus-4-6')
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(reflector.get(Model, TestAgent)).toBe('claude-opus-4-6')
  })

  it('test_model_on_tool_method', () => {
    @Toolbox({ namespace: 'code' })
    class CodeTools {
      @Tool({ name: 'generate', description: 'Generate code', input: z.object({}) })
      @Model('claude-opus-4-6')
      async generate() { return '' }

      @Tool({ name: 'lint', description: 'Lint', input: z.object({}) })
      async lint() { return '' }
    }

    expect(reflector.get(Model, CodeTools, 'generate')).toBe('claude-opus-4-6')
    expect(reflector.get(Model, CodeTools, 'lint')).toBeUndefined()
  })

  it('test_model_hierarchical_resolution_tool_overrides_agent', () => {
    @Agent({ name: 'test', route: '/test' })
    @Model('claude-sonnet-4-5-20250929')
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    @Toolbox()
    class Tools {
      @Tool({ name: 'heavy', description: 'Heavy', input: z.object({}) })
      @Model('claude-opus-4-6')
      async heavy() { return '' }

      @Tool({ name: 'light', description: 'Light', input: z.object({}) })
      async light() { return '' }
    }

    // Tool-level override wins
    expect(reflector.getAllAndOverride(Model, Tools, 'heavy')).toBe('claude-opus-4-6')

    // No tool-level → falls back to class-level (would need agent class in real resolution)
    expect(reflector.getAllAndOverride(Model, Tools, 'light')).toBeUndefined()

    // Agent-level
    expect(reflector.get(Model, TestAgent)).toBe('claude-sonnet-4-5-20250929')
  })

  it('test_model_on_toolbox_class_level', () => {
    @Toolbox({ namespace: 'research' })
    @Model('claude-opus-4-6')
    class ResearchTools {
      @Tool({ name: 'search', description: 'Search', input: z.object({}) })
      async search() { return '' }

      @Tool({ name: 'summarize', description: 'Summarize', input: z.object({}) })
      @Model('claude-haiku-4-5-20251001')
      async summarize() { return '' }
    }

    // Class-level model for toolbox
    expect(reflector.get(Model, ResearchTools)).toBe('claude-opus-4-6')

    // Method-level override
    expect(reflector.getAllAndOverride(Model, ResearchTools, 'summarize')).toBe('claude-haiku-4-5-20251001')

    // No method-level → falls back to class-level
    expect(reflector.getAllAndOverride(Model, ResearchTools, 'search')).toBe('claude-opus-4-6')
  })

  it('test_no_model_returns_undefined', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(reflector.get(Model, TestAgent)).toBeUndefined()
  })
})
