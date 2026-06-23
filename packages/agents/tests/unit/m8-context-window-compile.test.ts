import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Agent } from '../../src/decorators/agent.js'
import { MainLoop } from '../../src/decorators/main-loop.js'
import { ContextWindow, getContextWindowConfig } from '../../src/decorators/context-window.js'
import { walkAgentMetadata } from '../../src/bridge/walk-agent-metadata.js'
import { compileAgent } from '../../src/bridge/agent-compiler.js'
import { compileContextWindow } from '../../src/bridge/compile-context-window.js'

describe('compileContextWindow (M8-1)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('test_context_maxtokens_forwarded', () => {
    const { context } = compileContextWindow({ maxTokens: 50_000 })
    expect(context.maxTokens).toBe(50_000)
  })

  it('test_context_strategy_knobs_reported_metadata_only', () => {
    const { metadataOnlyKnobs } = compileContextWindow({
      compactionStrategy: 'truncate-oldest',
      preserveLastN: 5,
    })
    expect(metadataOnlyKnobs).toContain('compactionStrategy')
    expect(metadataOnlyKnobs).toContain('preserveLastN')
  })

  it('test_context_window_no_args_forwards_default_maxtokens', () => {
    // The decorator always applies defaults; the effective config forwards
    // maxTokens (100_000) and reports the un-forwardable strategy knobs.
    @Agent({ name: 'a', route: '/a' })
    @ContextWindow()
    class A {
      @MainLoop()
      async run() {}
    }
    const cfg = getContextWindowConfig(A)!
    const { context, metadataOnlyKnobs } = compileContextWindow(cfg)
    expect(context.maxTokens).toBe(100_000)
    expect(metadataOnlyKnobs.length).toBeGreaterThan(0)
  })

  it('test_walk_emits_context_strategy_warning_once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    @Agent({ name: 'rw', route: '/rw' })
    @ContextWindow({ compactionStrategy: 'sliding-window' })
    class Rw {
      @MainLoop()
      async run() {}
    }
    walkAgentMetadata(Rw)
    const hits = warn.mock.calls.filter((c) =>
      String(c[0]).includes('THEO_AGENT_CONTEXT_STRATEGY_METADATA_ONLY'),
    )
    expect(hits).toHaveLength(1)
  })

  it('test_compileAgent_emits_contextsettings', () => {
    @Agent({ name: 'cw', route: '/cw' })
    @ContextWindow({ maxTokens: 42_000 })
    class Cw {
      @MainLoop()
      async run() {}
    }
    const compiled = compileAgent(walkAgentMetadata(Cw))
    expect(compiled.context?.maxTokens).toBe(42_000)
  })

  it('test_context_window_options_shape_unchanged', () => {
    @Agent({ name: 's', route: '/s' })
    @ContextWindow({ maxTokens: 1 })
    class S {
      @MainLoop()
      async run() {}
    }
    const cfg = getContextWindowConfig(S)!
    // public ContextWindowOptions keys (decorator applies all defaults)
    expect(cfg).toHaveProperty('maxTokens')
    expect(cfg).toHaveProperty('compactionStrategy')
    expect(cfg).toHaveProperty('preserveLastN')
  })
})
