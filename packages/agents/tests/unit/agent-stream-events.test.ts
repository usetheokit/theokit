import { describe, it, expect } from 'vitest'
import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'
import {
  isTextDelta,
  isToolCall,
  isToolResult,
  isDone,
  isError,
  isApprovalRequired,
} from '../../src/bridge/agent-stream-events.js'

describe('AgentStreamEvent type guards', () => {
  it('test_text_delta', () => {
    const event: AgentStreamEvent = { type: 'text_delta', content: 'Hello' }
    expect(isTextDelta(event)).toBe(true)
    expect(isToolCall(event)).toBe(false)
    if (isTextDelta(event)) {
      expect(event.content).toBe('Hello')
    }
  })

  it('test_tool_call', () => {
    const event: AgentStreamEvent = {
      type: 'tool_call',
      callId: 'call-1',
      toolName: 'search',
      input: { query: 'test' },
    }
    expect(isToolCall(event)).toBe(true)
    if (isToolCall(event)) {
      expect(event.toolName).toBe('search')
      expect(event.callId).toBe('call-1')
    }
  })

  it('test_tool_result', () => {
    const event: AgentStreamEvent = {
      type: 'tool_result',
      callId: 'call-1',
      toolName: 'search',
      output: 'found 3 results',
      durationMs: 150,
      isError: false,
    }
    expect(isToolResult(event)).toBe(true)
    if (isToolResult(event)) {
      expect(event.durationMs).toBe(150)
      expect(event.isError).toBe(false)
    }
  })

  it('test_done', () => {
    const event: AgentStreamEvent = {
      type: 'done',
      result: 'Task completed',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
      durationMs: 2500,
    }
    expect(isDone(event)).toBe(true)
    if (isDone(event)) {
      expect(event.usage.totalTokens).toBe(150)
    }
  })

  it('test_error', () => {
    const event: AgentStreamEvent = {
      type: 'error',
      code: 'RATE_LIMITED',
      message: 'Too many requests',
      retryable: true,
    }
    expect(isError(event)).toBe(true)
    if (isError(event)) {
      expect(event.retryable).toBe(true)
    }
  })

  it('test_approval_required', () => {
    const event: AgentStreamEvent = {
      type: 'approval_required',
      callId: 'call-42',
      toolName: 'ops.deploy',
      question: 'Confirm deployment?',
      input: { env: 'production' },
      callbackUrl: '/agents/support/approve/call-42',
      timeoutMs: 300_000,
    }
    expect(isApprovalRequired(event)).toBe(true)
    if (isApprovalRequired(event)) {
      expect(event.callbackUrl).toContain('/approve/')
    }
  })

  it('test_thinking_event', () => {
    const event: AgentStreamEvent = { type: 'thinking', content: 'Let me analyze...' }
    expect(event.type).toBe('thinking')
    expect(isTextDelta(event)).toBe(false)
  })

  it('test_iteration_event', () => {
    const event: AgentStreamEvent = { type: 'iteration', step: 3, totalSteps: 10 }
    expect(event.type).toBe('iteration')
  })

  it('test_run_started_event', () => {
    const event: AgentStreamEvent = {
      type: 'run_started',
      runId: 'run-123',
      agentName: 'support',
      model: 'claude-sonnet-4-5-20250929',
    }
    expect(event.type).toBe('run_started')
  })

  it('test_discriminated_union_exhaustive', () => {
    // Verify all 9 event types exist in the union
    const events: AgentStreamEvent[] = [
      { type: 'run_started', runId: 'r', agentName: 'a' },
      { type: 'text_delta', content: '' },
      { type: 'tool_call', callId: 'c', toolName: 't', input: {} },
      { type: 'tool_result', callId: 'c', toolName: 't', output: '', durationMs: 0, isError: false },
      { type: 'thinking', content: '' },
      { type: 'iteration', step: 1, totalSteps: null },
      { type: 'approval_required', callId: 'c', toolName: 't', question: 'q', callbackUrl: 'u', timeoutMs: 0 },
      { type: 'error', code: 'E', message: 'm', retryable: false },
      { type: 'done', result: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 0 },
    ]
    expect(events).toHaveLength(9)
    const types = new Set(events.map(e => e.type))
    expect(types.size).toBe(9)
  })
})
