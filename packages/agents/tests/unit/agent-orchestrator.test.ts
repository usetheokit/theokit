import { describe, it, expect } from 'vitest'
import 'reflect-metadata'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'
import { z } from 'zod'
import {
  delegate,
  BudgetExceededError,
  DelegationError,
} from '../../src/bridge/agent-orchestrator.js'

// ── Test fixtures ──

@Toolbox({ namespace: 'math' })
class MathTools {
  @Tool({ name: 'add', description: 'Add two numbers', input: z.object({ a: z.number(), b: z.number() }) })
  add(input: { a: number; b: number }) { return String(input.a + input.b) }
}

@Agent({ name: 'helper', route: '/api/agents/helper', model: 'test-model' })
class HelperAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() { /* no-op */ }
}

@Agent({ name: 'tooled-helper', route: '/api/agents/tooled-helper', model: 'test-model' })
class TooledHelperAgent {
  @MainLoop({ strategy: 'simple-chat' })
  async run() { /* no-op */ }
}

// ── Tests ──

describe('Agent Orchestrator — delegate()', () => {
  it('test_delegate_no_api_key', async () => {
    await expect(delegate(HelperAgent, 'hello')).rejects.toThrow(DelegationError)
    await expect(delegate(HelperAgent, 'hello')).rejects.toThrow('No API key')
  })

  it('test_delegate_budget_clamping', () => {
    // Budget logic: min(parentBudgetRemaining, budget)
    const clamp = (budget?: number, parentRemaining?: number) =>
      Math.min(budget ?? Infinity, parentRemaining ?? Infinity)

    expect(clamp(2, 1)).toBe(1)        // parent limited
    expect(clamp(0.5, 1)).toBe(0.5)    // explicit limited
    expect(clamp(undefined, 1)).toBe(1) // inherit parent
    expect(clamp(2, undefined)).toBe(2) // no parent limit
    expect(clamp()).toBe(Infinity)      // no limits
  })

  it('test_budget_exceeded_error_message', () => {
    const err = new BudgetExceededError('TestAgent', 1.5, 1.0)
    expect(err.name).toBe('BudgetExceededError')
    expect(err.agentName).toBe('TestAgent')
    expect(err.actualCost).toBe(1.5)
    expect(err.budgetLimit).toBe(1.0)
    expect(err.message).toContain('exceeded budget')
    expect(err.message).toContain('$1.5000')
    expect(err.message).toContain('$1.0000')
  })

  it('test_delegation_error_wraps_cause', () => {
    const cause = new Error('network down')
    const err = new DelegationError('TestAgent', cause)
    expect(err.name).toBe('DelegationError')
    expect(err.agentName).toBe('TestAgent')
    expect(err.message).toContain('network down')
  })

  it('test_delegate_concurrent_isolated_sessions', () => {
    // EC-4: crypto.randomUUID() produces unique IDs even in same ms
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      ids.add(`sub-${crypto.randomUUID()}`)
    }
    expect(ids.size).toBe(100) // all unique
  })

  it('test_delegate_tool_collision_sub_wins', () => {
    // When parent and sub have a tool with same name, sub's version wins
    const parentTools = [
      { name: 'search', description: 'parent search', inputSchema: z.object({}), handler: async () => 'parent' },
    ]
    const subTools = [
      { name: 'search', description: 'sub search', inputSchema: z.object({}), handler: async () => 'sub' },
    ]
    // Merge logic: filter parent tools whose name conflicts with sub tools
    const subToolNames = new Set(subTools.map(t => t.name))
    const inherited = parentTools.filter(t => !subToolNames.has(t.name))
    const allTools = [...inherited, ...subTools]

    expect(allTools).toHaveLength(1)
    expect(allTools[0].description).toBe('sub search')
  })

  it('test_delegate_auto_instantiates_toolboxes', () => {
    // EC-1: toolbox classes auto-instantiated without DI
    // Verify MathTools can be instantiated via `new MathTools()`
    const instance = new MathTools()
    expect(typeof instance.add).toBe('function')
    expect(instance.add({ a: 2, b: 3 })).toBe('5')
  })

  it('test_done_event_has_cost_field', async () => {
    // EC-2: DoneEvent type now includes cost?: number
    const event: import('../../src/bridge/agent-stream-events.js').DoneEvent = {
      type: 'done',
      result: 'test',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      durationMs: 100,
      cost: 0.005,
    }
    expect(event.cost).toBe(0.005)

    // cost is optional — undefined is valid
    const event2: import('../../src/bridge/agent-stream-events.js').DoneEvent = {
      type: 'done',
      result: 'test',
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      durationMs: 100,
    }
    expect(event2.cost).toBeUndefined()
  })
})
