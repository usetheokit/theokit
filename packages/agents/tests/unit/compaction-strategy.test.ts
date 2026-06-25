/**
 * V4-F — CompactionStrategy: a named, callable authoring layer whose 'token-budget'
 * default DELEGATES to the SDK's compactTranscript (no reimplementation — G2/D2).
 * The SDK owns the algorithm; agents owns the named-strategy interface (ADR D1/D2/D3).
 *
 * BDD: Given the 'token-budget' strategy, When compact() is called, Then it forwards
 * to compactTranscript and returns its result; the config schema fails-fast (EC-2/EC-5).
 */
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ lastArgs: null as unknown, returnValue: [] as unknown[] }))

vi.mock('@theokit/sdk/compaction', () => ({
  compactTranscript: vi.fn(async (messages: unknown[], options: unknown) => {
    h.lastArgs = { messages, options }
    return h.returnValue
  }),
}))

const {
  tokenBudgetCompactionStrategy,
  resolveCompactionStrategy,
  compactionStrategyConfigSchema,
  DEFAULT_KEEP_TOKENS,
} = await import('../../src/loop/compaction-strategy.js')

interface Msg {
  role: string
  content: string
}
const msg = (content: string): Msg => ({ role: 'user', content })
const summarize = async (): Promise<Msg> => ({ role: 'system', content: 'summary' })

describe('V4-F CompactionStrategy — token-budget delegates to SDK compactTranscript', () => {
  it('test_token_budget_strategy_delegates_to_compactTranscript', async () => {
    h.lastArgs = null
    h.returnValue = [msg('kept')]
    const out = await tokenBudgetCompactionStrategy.compact([msg('a'), msg('b')] as never, {
      keepTokens: 8000,
      summarize: summarize as never,
    })
    // Given a transcript, When compact runs, Then compactTranscript got (msgs, {keepTokens, summarize})
    const opts = (
      h.lastArgs as { options: { keepTokens: number; summarize: unknown; failSafe: boolean } }
    ).options
    expect(opts.keepTokens).toBe(8000)
    expect(opts.summarize).toBe(summarize)
    // default-safe: failSafe defaults true (a thrown summarize must not lose the transcript)
    expect(opts.failSafe).toBe(true)
    expect(out).toEqual([msg('kept')])
  })

  it('test_compact_forwards_failSafe_marker_summaryTemplate', async () => {
    h.lastArgs = null
    h.returnValue = []
    await tokenBudgetCompactionStrategy.compact([msg('a')] as never, {
      summarize: summarize as never,
      marker: '<<cp>>',
      summaryTemplate: 'TPL',
      failSafe: false,
    })
    const opts = (
      h.lastArgs as { options: { marker: string; summaryTemplate: string; failSafe: boolean } }
    ).options
    expect(opts.marker).toBe('<<cp>>')
    expect(opts.summaryTemplate).toBe('TPL')
    expect(opts.failSafe).toBe(false) // app opt-out of fail-safe is honored
  })

  it('test_resolveCompactionStrategy_returns_token_budget_by_name', () => {
    const s = resolveCompactionStrategy('token-budget', { keepTokens: 8000 })
    expect(s.name).toBe('token-budget')
    expect(s.keepTokens).toBe(8000)
  })

  it('test_unknown_compaction_name_throws_typed_error_at_build', () => {
    // EC-5 — unknown name fails the zod enum parse (mirrors resolveLoopStrategy)
    expect(() => resolveCompactionStrategy('toke-budget' as never, { keepTokens: 8000 })).toThrow()
  })

  it('test_token_budget_requires_keepTokens', () => {
    // EC-2 — keepTokens REQUIRED for token-budget; no silent turn-count fallback (G10)
    expect(() => compactionStrategyConfigSchema.parse({ name: 'token-budget' })).toThrow()
    expect(() =>
      compactionStrategyConfigSchema.parse({ name: 'token-budget', keepTokens: 0 }),
    ).toThrow()
    expect(() =>
      compactionStrategyConfigSchema.parse({ name: 'token-budget', keepTokens: -5 }),
    ).toThrow()
    expect(
      compactionStrategyConfigSchema.parse({ name: 'token-budget', keepTokens: 8000 }),
    ).toEqual({ name: 'token-budget', keepTokens: 8000 })
  })

  it('test_compact_empty_and_below_budget_passthrough', async () => {
    // EC-3 — empty transcript delegates cleanly (compactTranscript never mutates / no-ops below budget)
    h.returnValue = []
    const out = await resolveCompactionStrategy('token-budget', { keepTokens: 8000 }).compact(
      [] as never,
      { summarize: summarize as never },
    )
    expect(out).toEqual([])
  })

  it('test_default_keep_tokens_matches_theocode_proven_value', () => {
    // tokenBudgetCompactionStrategy is the bare default; 8000 mirrors theocode DEFAULT_KEEP_TOKENS
    expect(DEFAULT_KEEP_TOKENS).toBe(8000)
    expect(tokenBudgetCompactionStrategy.keepTokens).toBe(8000)
  })
})

describe('V4-F @Compaction decorator + walk surfacing (T2.1)', () => {
  it('test_Compaction_decorator_stores_config', async () => {
    const { Compaction, getCompactionConfig } = await import('../../src/decorators/compaction.js')
    @Compaction('token-budget', { keepTokens: 8000 })
    class Decorated {
      run(): void {}
    }
    expect(getCompactionConfig(Decorated)).toEqual({ name: 'token-budget', keepTokens: 8000 })
  })

  it('test_walk_surfaces_compaction_config', async () => {
    const { Compaction } = await import('../../src/decorators/compaction.js')
    const { Agent } = await import('../../src/decorators/agent.js')
    const { MainLoop } = await import('../../src/decorators/main-loop.js')
    const { walkAgentMetadata } = await import('../../src/bridge/walk-agent-metadata.js')

    @Agent({ model: 'test-model' })
    @Compaction('token-budget', { keepTokens: 4000 })
    class WithCompaction {
      @MainLoop({ strategy: 'plan-act-reflect', maxIterations: 3 })
      async run() {}
    }

    @Agent({ model: 'test-model' })
    class WithoutCompaction {
      @MainLoop({ strategy: 'plan-act-reflect', maxIterations: 3 })
      async run() {}
    }

    expect(walkAgentMetadata(WithCompaction, []).compaction).toEqual({
      name: 'token-budget',
      keepTokens: 4000,
    })
    expect(walkAgentMetadata(WithoutCompaction, []).compaction).toBeUndefined()
  })
})
