import 'reflect-metadata'
import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { Toolbox, Tool } from '../../src/decorators/tool.js'
import { Artifact, getArtifactConfig } from '../../src/decorators/artifact.js'
import { Checkpoint, getCheckpointConfig } from '../../src/decorators/checkpoint.js'
import { Observable, getObservables, getObservableByChannel } from '../../src/decorators/observable.js'
import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'

// ─── @Artifact ──────────────────────────────────────────────

describe('@Artifact decorator', () => {
  it('test_artifact_stores_config_on_tool', () => {
    @Toolbox({ namespace: 'code' })
    class CodeTools {
      @Tool({ name: 'generate', description: 'Generate code', input: z.object({}) })
      @Artifact({ mimeType: 'text/typescript' })
      async generate() { return '' }
    }

    const config = getArtifactConfig(CodeTools, 'generate')!
    expect(config.mimeType).toBe('text/typescript')
    expect(config.streamable).toBe(true)
    expect(config.maxSize).toBe(0)
  })

  it('test_artifact_custom_options', () => {
    @Toolbox()
    class DocTools {
      @Tool({ name: 'write', description: 'Write doc', input: z.object({}) })
      @Artifact({ mimeType: 'text/markdown', streamable: false, maxSize: 1_000_000 })
      async write() { return '' }
    }

    const config = getArtifactConfig(DocTools, 'write')!
    expect(config.streamable).toBe(false)
    expect(config.maxSize).toBe(1_000_000)
  })

  it('test_no_artifact_returns_undefined', () => {
    @Toolbox()
    class Tools {
      @Tool({ name: 'search', description: 'Search', input: z.object({}) })
      async search() { return '' }
    }

    expect(getArtifactConfig(Tools, 'search')).toBeUndefined()
  })

  it('test_multiple_tools_different_artifacts', () => {
    @Toolbox({ namespace: 'gen' })
    class GenTools {
      @Tool({ name: 'code', description: 'Code', input: z.object({}) })
      @Artifact({ mimeType: 'text/typescript' })
      async code() { return '' }

      @Tool({ name: 'diagram', description: 'Diagram', input: z.object({}) })
      @Artifact({ mimeType: 'image/svg+xml' })
      async diagram() { return '' }

      @Tool({ name: 'json', description: 'JSON', input: z.object({}) })
      @Artifact({ mimeType: 'application/json' })
      async json() { return '' }
    }

    expect(getArtifactConfig(GenTools, 'code')!.mimeType).toBe('text/typescript')
    expect(getArtifactConfig(GenTools, 'diagram')!.mimeType).toBe('image/svg+xml')
    expect(getArtifactConfig(GenTools, 'json')!.mimeType).toBe('application/json')
  })
})

// ─── @Checkpoint ────────────────────────────────────────────

describe('@Checkpoint decorator', () => {
  it('test_checkpoint_stores_config', () => {
    @Agent({ name: 'research', route: '/research' })
    @Checkpoint({ storage: 'drizzle', strategy: 'after-tool-call', maxCheckpoints: 20, ttl: 7_200_000 })
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

  it('test_no_checkpoint_returns_undefined', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getCheckpointConfig(TestAgent)).toBeUndefined()
  })
})

// ─── @Observable ────────────────────────────────────────────

describe('@Observable decorator', () => {
  it('test_observable_stores_channel', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}

      @Observable('metrics')
      getMetrics() {
        return { tokens: 100, cost: 0.01 }
      }
    }

    const observables = getObservables(TestAgent)
    expect(observables).toHaveLength(1)
    expect(observables[0].channel).toBe('metrics')
    expect(observables[0].propertyKey).toBe('getMetrics')
  })

  it('test_multiple_observables', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}

      @Observable('metrics')
      getMetrics() { return {} }

      @Observable('progress')
      getProgress() { return {} }

      @Observable('approvals')
      getApprovals() { return [] }
    }

    expect(getObservables(TestAgent)).toHaveLength(3)
    expect(getObservableByChannel(TestAgent, 'progress')!.propertyKey).toBe('getProgress')
  })

  it('test_get_observable_by_channel', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}

      @Observable('cost')
      getCost() { return 0.05 }
    }

    expect(getObservableByChannel(TestAgent, 'cost')).toBeDefined()
    expect(getObservableByChannel(TestAgent, 'nonexistent')).toBeUndefined()
  })

  it('test_no_observables_returns_empty', () => {
    @Agent({ name: 'test', route: '/test' })
    class TestAgent {
      @MainLoop()
      async run() {}
    }

    expect(getObservables(TestAgent)).toEqual([])
  })
})

// ─── Stream Event Types ─────────────────────────────────────

describe('New stream event types', () => {
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
      { type: 'tool_result', callId: 'c', toolName: 't', output: '', durationMs: 0, isError: false },
      { type: 'thinking', content: '' },
      { type: 'iteration', step: 1, totalSteps: null },
      { type: 'approval_required', callId: 'c', toolName: 't', question: 'q', callbackUrl: 'u', timeoutMs: 0 },
      { type: 'artifact_start', artifactId: 'a', mimeType: 'm' },
      { type: 'artifact_chunk', artifactId: 'a', chunk: '', isLast: true },
      { type: 'state_update', channel: 'c', data: {} },
      { type: 'checkpoint_saved', checkpointId: 'c', step: 0, resumeToken: 't' },
      { type: 'error', code: 'E', message: 'm', retryable: false },
      { type: 'done', result: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, durationMs: 0 },
    ]
    expect(events).toHaveLength(13)
    expect(new Set(events.map(e => e.type)).size).toBe(13)
  })
})
