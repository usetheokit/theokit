import { describe, expect, it, vi } from 'vitest'

import type { CompressibleMessage } from '@theokit/sdk/compaction'

import type {
  CompactionCallOptions,
  TranscriptCompactionStrategy,
} from '../../src/loop/compaction-strategy.js'
import { PreCompactionHandlerError, withPreCompaction } from '../../src/loop/pre-compaction.js'

/**
 * The public entry, loaded ONCE at module scope.
 *
 * FR-003 measures reachability through the package's public export map, so the test must load that
 * map and not a relative path. Loading it inside the test body charged ~1s of barrel evaluation to
 * a single test and, alone, broke NFR-003's 500 ms budget for the added tests. Hoisting matches the
 * pattern `tests/integration/compaction-runner.test.ts` already uses.
 */
const publicEntry = (await import('../../src/index.js')) as Record<string, unknown>

/**
 * B-002 FR-001..003 — a seam that runs, and is awaited, BEFORE the transcript is rewritten.
 *
 * The requirement is ORDER. The brief's Interaction diagram says it in one line — "a handler that
 * runs after proves nothing" — so every test here asserts against a recorded timeline rather than
 * against invocation alone. A test that only proves the handler was called would pass against a
 * decorator that calls it afterwards, which is the defect this item exists to close.
 *
 * The three MUST FIX items from `/edge-case-plan` (2026-09-14) each have a test below:
 * EC-1 the timer outliving the handler, EC-2 the delegated call dropping the caller's options,
 * EC-3 the handler mutating the array the strategy contract says is never mutated.
 */

/** A strategy that records when it was entered, and with what. */
function recordingStrategy(timeline: string[]): TranscriptCompactionStrategy & {
  readonly seen: { options?: CompactionCallOptions }
} {
  const seen: { options?: CompactionCallOptions } = {}
  return {
    name: 'token-budget',
    keepTokens: 1234,
    seen,
    compact: async (messages: CompressibleMessage[], options?: CompactionCallOptions) => {
      timeline.push('compact')
      seen.options = options
      return messages.slice(1)
    },
  }
}

const MESSAGES = [
  { role: 'user', content: 'one' },
  { role: 'assistant', content: 'two' },
] as unknown as CompressibleMessage[]

describe('a pre-compaction handler runs before the rewrite', () => {
  it('test_pre-compaction_handler_is_registered', async () => {
    const timeline: string[] = []
    const handler = vi.fn(async () => {
      timeline.push('handler')
    })

    const wrapped = withPreCompaction(recordingStrategy(timeline), handler)
    await wrapped.compact(MESSAGES)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('test_runs_BEFORE_the_transcript_is_rewritten', async () => {
    // The claim is the ORDER, so the assertion is the order. Membership would pass against a
    // decorator that runs the handler after compaction, which is the whole defect.
    const timeline: string[] = []
    const wrapped = withPreCompaction(recordingStrategy(timeline), async () => {
      timeline.push('handler')
    })

    await wrapped.compact(MESSAGES)

    expect(timeline).toEqual(['handler', 'compact'])
  })

  it('test_the_run_awaits_the_handler', async () => {
    // A happens-before observation against recorded marks, not a wall-clock sleep: a test that
    // races the clock is a test that fails on a loaded CI box for reasons unrelated to the code.
    const timeline: string[] = []
    let releaseHandler: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseHandler = resolve
    })

    const wrapped = withPreCompaction(recordingStrategy(timeline), async () => {
      timeline.push('handler:enter')
      await gate
      timeline.push('handler:exit')
    })

    const pending = wrapped.compact(MESSAGES)
    await Promise.resolve()

    expect(timeline, 'compaction started before the handler finished').toEqual(['handler:enter'])

    releaseHandler?.()
    await pending

    expect(timeline).toEqual(['handler:enter', 'handler:exit', 'compact'])
  })

  it('test_the_per_call_options_reach_the_wrapped_strategy', async () => {
    // EC-2. A decorator written as "await, then compact" naturally delegates `compact(messages)`
    // and silently drops `summarize` — without which `compactTranscript` has no summarizer at all.
    const timeline: string[] = []
    const inner = recordingStrategy(timeline)
    const options: CompactionCallOptions = {
      keepTokens: 99,
      summarize: async () => 'summary',
      marker: 'MARK',
      summaryTemplate: 'TPL',
      failSafe: false,
    }

    await withPreCompaction(inner, async () => undefined).compact(MESSAGES, options)

    expect(inner.seen.options, 'the caller options never reached the wrapped strategy').toBe(
      options,
    )
  })

  it('test_the_handler_cannot_mutate_the_transcript', async () => {
    // EC-3. `TranscriptCompactionStrategy.compact` documents "never mutates the input"; adding a
    // seam that hands the array to a caller creates a mutation path THROUGH that contract.
    const timeline: string[] = []
    const original = [...MESSAGES]

    const wrapped = withPreCompaction(recordingStrategy(timeline), async (messages) => {
      ;(messages as CompressibleMessage[]).push({ role: 'user', content: 'injected' } as never)
    })

    await wrapped.compact(MESSAGES)

    expect(MESSAGES, 'the handler mutated the caller array').toEqual(original)
  })

  it('test_a_rejecting_handler_is_reported_and_compaction_proceeds', async () => {
    const timeline: string[] = []
    const onError = vi.fn()

    const wrapped = withPreCompaction(
      recordingStrategy(timeline),
      async () => {
        throw new Error('handler blew up')
      },
      { onError },
    )

    const result = await wrapped.compact(MESSAGES)

    expect(timeline).toEqual(['compact'])
    expect(result).toHaveLength(MESSAGES.length - 1)
    expect(onError).toHaveBeenCalledTimes(1)
    const reported = onError.mock.calls[0]?.[0] as PreCompactionHandlerError
    expect(reported).toBeInstanceOf(PreCompactionHandlerError)
    expect(reported.message).toContain('handler blew up')
  })

  it('test_a_synchronously_thrown_handler_is_reported_like_a_rejection', async () => {
    // EC-4. `const p = handler(); await p` catches a rejection and lets a synchronous throw escape,
    // so the two failure shapes are asserted separately or one of them ships unhandled.
    const timeline: string[] = []
    const onError = vi.fn()

    const wrapped = withPreCompaction(
      recordingStrategy(timeline),
      (() => {
        throw new Error('sync boom')
      }) as never,
      { onError },
    )

    await wrapped.compact(MESSAGES)

    expect(timeline).toEqual(['compact'])
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0]?.[0] as Error).message).toContain('sync boom')
  })

  it('test_a_hanging_handler_is_bounded_and_compaction_proceeds', async () => {
    const timeline: string[] = []
    const onError = vi.fn()

    const wrapped = withPreCompaction(
      recordingStrategy(timeline),
      () => new Promise<void>(() => undefined),
      { timeoutMs: 10, onError },
    )

    await wrapped.compact(MESSAGES)

    expect(timeline, 'compaction did not happen after the handler timed out').toEqual(['compact'])
    expect(onError).toHaveBeenCalledTimes(1)
    expect((onError.mock.calls[0]?.[0] as Error).message).toMatch(/10\s*ms|timed out/i)
  })

  it('test_the_timer_is_cleared_when_the_handler_wins', async () => {
    // EC-1. Racing a handler against a timer leaves the timer pending on every call the handler
    // wins — which is every normal call. In Node the suite then exits late or not at all.
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const before = clear.mock.calls.length

    await withPreCompaction(recordingStrategy([]), async () => undefined).compact(MESSAGES)

    expect(
      clear.mock.calls.length,
      'the timeout timer was never cleared after the handler resolved',
    ).toBeGreaterThan(before)
    clear.mockRestore()
  })

  it('test_an_unusable_timeout_is_refused_at_registration', async () => {
    // EC-5. A silently accepted `timeoutMs: 0` reports every handler as timed out, which reads as
    // "my handler never runs" and sends the reader to the wrong file.
    for (const bad of [0, -1, Number.NaN]) {
      expect(
        () => withPreCompaction(recordingStrategy([]), async () => undefined, { timeoutMs: bad }),
        `timeoutMs ${String(bad)} was accepted`,
      ).toThrow(/timeoutMs/)
    }
  })

  it('test_the_decorated_strategy_is_substitutable', async () => {
    // Liskov, and NFR-004's "0 changes in existing consumers": every consumer of the interface
    // must accept the decorated value, which means `name` and `keepTokens` survive unchanged.
    const inner = recordingStrategy([])
    const wrapped = withPreCompaction(inner, async () => undefined)

    expect(wrapped.name).toBe(inner.name)
    expect(wrapped.keepTokens).toBe(inner.keepTokens)
  })
})

describe('the seam is reachable the way a consumer reaches it', () => {
  it('test_reachable_from_the_public_entry_point', () => {
    // FR-003 says "through the public export map, not by importing SDK internals". A relative
    // import would prove the module works and say nothing about what a consumer can reach — which
    // is the failure this package's own README records as costing a downstream product ~120 lines.
    expect(
      typeof publicEntry.withPreCompaction,
      'withPreCompaction is not on the public entry',
    ).toBe('function')
    expect(publicEntry.PreCompactionHandlerError, 'the typed error is unreachable').toBeTypeOf(
      'function',
    )
  })
})
