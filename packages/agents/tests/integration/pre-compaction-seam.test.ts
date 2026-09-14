import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ seen: null as unknown }))

vi.mock('@theokit/sdk/compaction', () => ({
  compactTranscript: vi.fn(async (messages: unknown[], options: unknown) => {
    h.seen = { count: (messages as unknown[]).length, options }
    return (messages as unknown[]).slice(1)
  }),
}))

const { AgentRunner, withPreCompaction } = await import('../../src/index.js')
const { applyCapabilities } = await import('../../src/capability/capability.js')
const { ModelCapability } = await import('../../src/capability/capabilities.js')

/**
 * B-002 FR-001..003 at the seam a consumer actually holds.
 *
 * The unit tests prove the Decorator orders correctly in isolation. They do not prove the app-called
 * path carries it: `runner.compaction` is the handle the runner exposes, and a seam that works in a
 * test file and is unreachable through the runner satisfies nothing anybody can use.
 */
const agent = applyCapabilities([new ModelCapability('test-model')])

const MESSAGES = [
  { role: 'user', content: 'one' },
  { role: 'assistant', content: 'two' },
  { role: 'user', content: 'three' },
] as never[]

describe('the pre-compaction seam through runner.compaction', () => {
  it('test_the_handler_reads_the_PRE_compaction_transcript', async () => {
    // The brief's Interaction note is the point: the handler reads what compaction is about to
    // destroy. Asserting only that it RAN would pass against a handler invoked afterwards, which
    // is the defect this item exists to close — so both sides of the relationship are asserted.
    const runner = AgentRunner.fromSpec({
      compiled: agent,
      name: 'agent',
      strategy: 'plan-act-reflect' as const,
    })
      .compaction('token-budget', { keepTokens: 8000 })
      .build()

    expect(runner.compaction, 'the runner exposes no compaction handle').toBeDefined()

    let observedByHandler: number | undefined
    const guarded = withPreCompaction(runner.compaction!, (messages) => {
      observedByHandler = messages.length
    })

    const result = await guarded.compact(MESSAGES)

    expect(observedByHandler, 'the handler never ran').toBe(MESSAGES.length)
    expect(result.length, 'compaction did not shorten the transcript').toBeLessThan(MESSAGES.length)
  })

  it('test_a_failing_handler_does_not_stop_compaction_through_the_runner', async () => {
    const runner = AgentRunner.fromSpec({
      compiled: agent,
      name: 'agent',
      strategy: 'plan-act-reflect' as const,
    })
      .compaction('token-budget', { keepTokens: 8000 })
      .build()

    const onError = vi.fn()
    const guarded = withPreCompaction(
      runner.compaction!,
      async () => {
        throw new Error('persistence failed')
      },
      { onError },
    )

    const result = await guarded.compact(MESSAGES)

    expect(result.length).toBeLessThan(MESSAGES.length)
    expect(onError, 'the failure was swallowed instead of reported').toHaveBeenCalledTimes(1)
  })

  it('test_the_runner_keepTokens_still_reaches_the_sdk_through_the_decorator', async () => {
    // NFR-004's "0 changes in existing consumers", asserted end to end: wrapping must not change
    // what the SDK receives. EC-2 at unit level proves the options object; this proves the budget
    // the runner resolved still arrives.
    const runner = AgentRunner.fromSpec({
      compiled: agent,
      name: 'agent',
      strategy: 'plan-act-reflect' as const,
    })
      .compaction('token-budget', { keepTokens: 4242 })
      .build()

    await withPreCompaction(runner.compaction!, () => undefined).compact(MESSAGES)

    expect((h.seen as { options: { keepTokens?: number } }).options.keepTokens).toBe(4242)
  })
})
