import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Checkpoint, getCheckpointConfig } from '../../src/decorators/checkpoint.js'
import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'

// ─── @Artifact ──────────────────────────────────────────────

describe('@Artifact decorator', () => {
  it('test_checkpoint_stores_config', () => {
    @Agent({ name: 'research', route: '/research' })
    @Checkpoint({
      storage: 'drizzle',
      strategy: 'after-tool-call',
      maxCheckpoints: 20,
      ttl: 7_200_000,
    })
    class ResearchAgent {
      @MainLoop()
      async run() {}
    }

    const config = getCheckpointConfig(ResearchAgent)!
    expect(config.storage).toBe('drizzle')
    expect(config.strategy).toBe('after-tool-call')
    expect(config.maxCheckpoints).toBe(20)
    expect(config.ttl).toBe(7_200_000)
  })

  it('test_checkpoint_defaults', () => {
    @Agent({ name: 'test', route: '/test' })
    @Checkpoint()
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    const config = getCheckpointConfig(TestAgent)!
    expect(config.storage).toBe('memory')
    expect(config.strategy).toBe('after-tool-call')
    expect(config.maxCheckpoints).toBe(10)
    expect(config.ttl).toBe(3_600_000)
  })

  it('test_checkpoint_manual_strategy', () => {
    @Agent({ name: 'test', route: '/test' })
    @Checkpoint({ strategy: 'manual' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getCheckpointConfig(TestAgent)!.strategy).toBe('manual')
  })

  it('test_checkpoint_after_iteration', () => {
    @Agent({ name: 'test', route: '/test' })
    @Checkpoint({ strategy: 'after-iteration' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getCheckpointConfig(TestAgent)!.strategy).toBe('after-iteration')
  })

  it('test_artifact_events_in_union', () => {
    const start: AgentStreamEvent = {
      type: 'artifact_start',
      artifactId: 'art-1',
      mimeType: 'text/typescript',
      filename: 'component.tsx',
      metadata: { loc: 42 },
    }
    expect(start.type).toBe('artifact_start')

    const chunk: AgentStreamEvent = {
      type: 'artifact_chunk',
      artifactId: 'art-1',
      chunk: 'export function Foo() {}',
      isLast: true,
    }
    expect(chunk.type).toBe('artifact_chunk')
  })

  it('test_state_update_event', () => {
    const event: AgentStreamEvent = {
      type: 'state_update',
      channel: 'metrics',
      data: { tokensUsed: 500, costUsd: 0.02, iteration: 3 },
    }
    expect(event.type).toBe('state_update')
  })

  it('test_checkpoint_saved_event', () => {
    const event: AgentStreamEvent = {
      type: 'checkpoint_saved',
      checkpointId: 'chk-123',
      step: 5,
      resumeToken: 'resume_abc123',
    }
    expect(event.type).toBe('checkpoint_saved')
  })

  it('test_all_13_event_types', () => {
    const events: AgentStreamEvent[] = [
      { type: 'run_started', runId: 'r', agentName: 'a' },
      { type: 'text_delta', content: '' },
      { type: 'tool_call', callId: 'c', toolName: 't', input: {} },
      {
        type: 'tool_result',
        callId: 'c',
        toolName: 't',
        output: '',
        durationMs: 0,
        isError: false,
      },
      { type: 'thinking', content: '' },
      { type: 'iteration', step: 1, totalSteps: null },
      {
        type: 'approval_required',
        callId: 'c',
        toolName: 't',
        question: 'q',
        callbackUrl: 'u',
        timeoutMs: 0,
      },
      { type: 'artifact_start', artifactId: 'a', mimeType: 'm' },
      { type: 'artifact_chunk', artifactId: 'a', chunk: '', isLast: true },
      { type: 'state_update', channel: 'c', data: {} },
      { type: 'checkpoint_saved', checkpointId: 'c', step: 0, resumeToken: 't' },
      { type: 'error', code: 'E', message: 'm', retryable: false },
      {
        type: 'done',
        result: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 0,
      },
    ]
    expect(events).toHaveLength(13)
    expect(new Set(events.map((e) => e.type)).size).toBe(13)
  })
})
