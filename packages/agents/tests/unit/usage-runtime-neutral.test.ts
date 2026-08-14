import { describe, expect, it } from 'vitest'

import { InMemoryUsageStorage } from '../../src/usage/index.js'

/**
 * M84 — the acceptance criterion, stated as a test.
 *
 * > a terminal product that depends **only** on `@theokit/agents` can record and query usage without
 * > adding `theokit`.
 *
 * This file imports nothing from `theokit`, which is the assertion: 1 715 LOC of observability and
 * cost lived under `packages/theo/src/server/**`, and `theokit` is the Vite/React web framework. The
 * only real product on this stack never imports it — a grep for `from 'theokit` in it returns zero.
 */

const llm = (costUsd: number, at = new Date('2026-01-01')) => ({
  model: 'claude-sonnet-4-5',
  tokens: { input: 100, output: 50 },
  costUsd,
  timestamp: at,
})

describe('usage without a userId — the terminal case', () => {
  it('test_a_record_with_NO_user_is_accepted_and_counted', async () => {
    // A terminal agent has no user; it has a person at a keyboard. Requiring the field forced every
    // terminal product to invent a constant — and an invented identifier is worse than an absent
    // one, because it looks like data.
    const storage = new InMemoryUsageStorage()
    await storage.record(llm(0.01))

    await expect(storage.getUsage({})).resolves.toEqual({
      totalTokens: 150,
      totalCostUsd: 0.01,
      runs: 1,
    })
  })

  it('test_a_query_WITH_a_user_still_filters', async () => {
    // The counter-proof: making `userId` optional must not make it meaningless for the HTTP path.
    const storage = new InMemoryUsageStorage()
    await storage.record({ ...llm(0.01), userId: 'alice' })
    await storage.record({ ...llm(0.02), userId: 'bob' })

    await expect(storage.getUsage({ userId: 'alice' })).resolves.toMatchObject({ runs: 1 })
  })

  it('test_a_period_narrows_the_window', async () => {
    const storage = new InMemoryUsageStorage()
    await storage.record(llm(0.01, new Date('2026-01-01')))
    await storage.record(llm(0.02, new Date('2026-06-01')))

    await expect(
      storage.getUsage({ period: { from: new Date('2026-05-01'), to: new Date('2026-07-01') } }),
    ).resolves.toMatchObject({ runs: 1, totalCostUsd: 0.02 })
  })
})

describe('latestUsage — what a terminal footer asks after every turn', () => {
  it('test_it_returns_the_most_recent_llm_record', async () => {
    const storage = new InMemoryUsageStorage()
    await storage.record(llm(0.01))
    await storage.record(llm(0.02))

    expect(storage.latestUsage()?.costUsd).toBe(0.02)
  })

  it('test_a_TOOL_record_does_not_become_the_latest_usage', async () => {
    // A tool invocation has no token cost of its own. Returning one here would make the footer show
    // zero after every tool call, which reads as "the last turn was free".
    const storage = new InMemoryUsageStorage()
    await storage.record(llm(0.03))
    await storage.record({
      kind: 'tool',
      conversationId: 'c1',
      toolName: 'run_shell',
      callId: 'call-1',
      success: true,
      durationMs: 12,
      timestamp: new Date(),
    })

    expect(storage.latestUsage()?.costUsd).toBe(0.03)
  })

  it('test_nothing_recorded_yet_is_undefined_not_a_zero_run', async () => {
    // A zero would render as "this turn cost nothing", which is a claim. `undefined` renders as
    // nothing, which is the truth before the first turn.
    expect(new InMemoryUsageStorage().latestUsage()).toBeUndefined()
  })
})

describe('the legacy shape keeps working', () => {
  it('test_a_record_with_no_kind_is_normalised_to_llm', async () => {
    const storage = new InMemoryUsageStorage()
    await storage.record(llm(0.01))
    expect(storage.latestUsage()?.kind).toBe('llm')
  })
})
