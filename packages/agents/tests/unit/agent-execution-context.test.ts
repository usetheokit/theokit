import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { createAgentExecutionContext, isAgentContext } from '../../src/bridge/agent-execution-context.js'
import type { ExecutionContext, CanActivate } from '@theokit/http'

describe('AgentExecutionContext', () => {
  const mockReq = new Request('http://localhost/test', { method: 'POST' })
  const mockUrl = new URL('http://localhost/test')
  class TestAgent {}

  function makeBase(): ExecutionContext {
    return {
      getRequest: () => mockReq,
      getUrl: () => mockUrl,
      getClass: () => TestAgent,
      getMethodName: () => 'run',
    }
  }

  it('test_extends_execution_context', () => {
    const ctx = createAgentExecutionContext(
      makeBase(),
      { name: 'test', route: '/test' },
      { id: 'run-1', startedAt: new Date() },
    )

    // Base ExecutionContext methods work (Web Standard)
    expect(ctx.getRequest()).toBe(mockReq)
    expect(ctx.getUrl()).toBe(mockUrl)
    expect(ctx.getClass()).toBe(TestAgent)
    expect(ctx.getMethodName()).toBe('run')
  })

  it('test_agent_specific_methods', () => {
    const agent = { name: 'support', route: '/api/agents/support' }
    const run = { id: 'run-42', startedAt: new Date('2026-06-09') }
    const tool = { name: 'search', description: 'Search', input: {} as never }

    const ctx = createAgentExecutionContext(makeBase(), agent, run, tool)

    expect(ctx.getAgent()).toBe(agent)
    expect(ctx.getRun()).toBe(run)
    expect(ctx.getToolCall()).toBe(tool)
  })

  it('test_tool_call_null_when_not_provided', () => {
    const ctx = createAgentExecutionContext(
      makeBase(),
      { name: 'test', route: '/test' },
      { id: 'run-1', startedAt: new Date() },
    )

    expect(ctx.getToolCall()).toBeNull()
  })

  it('test_is_agent_context_type_guard', () => {
    const ctx = createAgentExecutionContext(
      makeBase(),
      { name: 'test', route: '/test' },
      { id: 'run-1', startedAt: new Date() },
    )

    expect(ctx.isAgentContext()).toBe(true)
    expect(isAgentContext(ctx)).toBe(true)
  })

  it('test_regular_context_is_not_agent_context', () => {
    const base = makeBase()
    expect(isAgentContext(base)).toBe(false)
  })

  it('test_lsp_guard_compatibility', () => {
    // A guard written for ExecutionContext accepts AgentExecutionContext
    class SimpleGuard implements CanActivate {
      canActivate(context: ExecutionContext): boolean {
        return context.getRequest().method === 'POST'
      }
    }

    const ctx = createAgentExecutionContext(
      makeBase(),
      { name: 'test', route: '/test' },
      { id: 'run-1', startedAt: new Date() },
    )

    const guard = new SimpleGuard()
    expect(guard.canActivate(ctx)).toBe(true) // LSP: AgentExecutionContext IS-A ExecutionContext
  })
})
