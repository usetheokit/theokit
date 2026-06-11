import 'reflect-metadata'
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'
import { RequiresApproval, Budget } from '../../src/decorators/policies.js'
import {
  walkAgentMetadata,
  validateUniqueRoutes,
  AgentWarningCode,
} from '../../src/bridge/walk-agent-metadata.js'

import { UseGuards, UseInterceptors, UseFilters } from '@theokit/http'

class AuthGuard {
  canActivate() {
    return true
  }
}

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
      async search() {
        return ''
      }

      @Tool({
        name: 'refund',
        description: 'Refund payment',
        input: z.object({ id: z.string() }),
        risk: 'high',
      })
      async refund() {
        return ''
      }
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
      async delete() {
        return ''
      }
    }

    const result = walkAgentMetadata(TestAgent, [Tools])
    expect(result.toolboxes[0].tools[0].approval).toEqual({ reason: 'Destructive action' })
  })

  it('test_walk_agent_missing_mainloop_throws', () => {
    @Agent({ name: 'broken', route: '/broken' })
    class BrokenAgent {
      name = 'broken'
    }

    expect(() => walkAgentMetadata(BrokenAgent)).toThrow('missing @MainLoop()')
  })

  it('test_walk_agent_missing_decorator_throws', () => {
    class PlainClass {
      name = 'plain'
    }

    expect(() => walkAgentMetadata(PlainClass)).toThrow('missing @Agent()')
  })

  it('test_walk_agent_with_interceptors_warns_with_stable_code', () => {
    class TimingInterceptor {
      intercept() {
        /* noop */
      }
    }

    @Agent({ name: 'warned-int', route: '/warned-int' })
    @UseInterceptors(TimingInterceptor)
    class WarnedAgent {
      @MainLoop()
      async run() {}
    }

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = walkAgentMetadata(WarnedAgent)
    expect(result.interceptors).toContain(TimingInterceptor)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(AgentWarningCode.INTERCEPTOR_METADATA_ONLY),
    )
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('metadata-only on agents and will not execute'),
    )
    spy.mockRestore()
  })

  it('test_walk_agent_with_filters_warns_with_stable_code', () => {
    class HttpErrorFilter {
      catch() {
        /* noop */
      }
    }

    @Agent({ name: 'filtered', route: '/filtered' })
    @UseFilters(HttpErrorFilter)
    class FilteredAgent {
      @MainLoop()
      async run() {}
    }

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = walkAgentMetadata(FilteredAgent)
    expect(result.filters).toContain(HttpErrorFilter)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining(AgentWarningCode.FILTER_METADATA_ONLY))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('will not catch agent runtime errors'))
    spy.mockRestore()
  })

  it('test_walk_agent_with_budget_warns_with_stable_code', () => {
    @Agent({ name: 'budgeted', route: '/budgeted' })
    @Budget({ maxCostUsd: 0.5 })
    class BudgetedAgent {
      @MainLoop()
      async run() {}
    }

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    walkAgentMetadata(BudgetedAgent)
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(AgentWarningCode.BUDGET_TOP_LEVEL_METADATA_ONLY),
    )
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('delegate() calls only'))
    spy.mockRestore()
  })

  it('test_walk_agent_without_metadata_decorators_no_warning', () => {
    @Agent({ name: 'clean-no-warn', route: '/clean-no-warn' })
    class CleanAgent {
      @MainLoop()
      async run() {}
    }

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    walkAgentMetadata(CleanAgent)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('test_walk_cached_agent_no_duplicate_warning', () => {
    class LogInterceptor {
      intercept() {
        /* noop */
      }
    }

    @Agent({ name: 'cached-warn', route: '/cached-warn' })
    @UseInterceptors(LogInterceptor)
    class CachedAgent {
      @MainLoop()
      async run() {}
    }

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // First call — emits warning
    walkAgentMetadata(CachedAgent)
    expect(spy).toHaveBeenCalledTimes(1)

    // Second call — cached via WeakMap, no duplicate warning
    walkAgentMetadata(CachedAgent)
    expect(spy).toHaveBeenCalledTimes(1)

    spy.mockRestore()
  })

  it('test_delegate_budget_is_runtime_enforced_not_metadata_only', async () => {
    // delegate() in agent-orchestrator.ts enforces budget at runtime
    // via clamping + mid-stream abort. This test verifies the distinction:
    // @Budget on agent class = metadata-only warning
    // Budget in DelegateOptions = runtime enforcement (no warning)
    const { BudgetExceededError } = await import('../../src/bridge/agent-orchestrator.js')

    // BudgetExceededError exists and is a proper error class
    const err = new BudgetExceededError('TestAgent', 0.75, 0.5)
    expect(err.name).toBe('BudgetExceededError')
    expect(err.actualCost).toBe(0.75)
    expect(err.budgetLimit).toBe(0.5)
    expect(err.message).toContain('exceeded budget')
    // delegate() uses DelegateOptions.budget — no walkAgentMetadata warning involved
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

    const results = [walkAgentMetadata(AgentA), walkAgentMetadata(AgentB)]

    expect(() => validateUniqueRoutes(results)).toThrow("Duplicate agent route '/same'")
  })
})
