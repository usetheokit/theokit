import { describe, expect, it } from 'vitest'

import type { TurnRun } from '../src/agent-port.js'
import { formatUsageFooter, formatUsageLine, usageOf } from '../src/usage/turn-usage.js'

type RunResult = Awaited<ReturnType<TurnRun['wait']>>

const MODEL = 'openai/gpt-4o-mini'

function finished(extra: Partial<RunResult>): RunResult {
  return { status: 'finished', ...extra }
}

describe('usageOf', () => {
  it('a priced run reports its cost.amountUsd', () => {
    const usage = usageOf(finished({ usage: { inputTokens: 120, outputTokens: 30 }, cost: { amountUsd: 0.00042 } }), MODEL)
    expect(usage).toEqual({ inputTokens: 120, outputTokens: 30, model: MODEL, costUsd: 0.00042 })
  })

  it('an unpriced run reports no cost, never 0', () => {
    const usage = usageOf(finished({ usage: { inputTokens: 5, outputTokens: 7 }, cost: { amountUsd: undefined } }), MODEL)
    expect(usage).toEqual({ inputTokens: 5, outputTokens: 7, model: MODEL, costUnpriced: true })
    expect(usage).not.toHaveProperty('costUsd')
    expect(formatUsageLine('control', usage)).toContain('cost=unpriced')
  })

  it('a run with no cost at all is unpriced', () => {
    expect(usageOf(finished({}), MODEL)).toEqual({ inputTokens: 0, outputTokens: 0, model: MODEL, costUnpriced: true })
  })

  it('a NaN, infinite or null amount is unpriced', () => {
    for (const amountUsd of [Number.NaN, Number.POSITIVE_INFINITY, null as unknown as number]) {
      expect(usageOf(finished({ cost: { amountUsd } }), MODEL)).toMatchObject({ costUnpriced: true })
    }
  })

  it('a 0 amount the SDK priced is cost 0', () => {
    const usage = usageOf(finished({ usage: { inputTokens: 1, outputTokens: 1 }, cost: { amountUsd: 0 } }), MODEL)
    expect(usage.costUsd).toBe(0)
    expect(usage.costUnpriced).toBeUndefined()
    expect(formatUsageLine('channel', usage)).toBe(`theoclaw: usage channel ${MODEL} in=1 out=1 cost=$0`)
  })
})

describe('formatUsageLine', () => {
  it('a cost below 0.000001 prints its digits, not 0', () => {
    const usage = usageOf(finished({ usage: { inputTokens: 3, outputTokens: 2 }, cost: { amountUsd: 4e-7 } }), MODEL)
    const line = formatUsageLine('webchat', usage)
    expect(line).toBe(`theoclaw: usage webchat ${MODEL} in=3 out=2 cost=$0.0000004`)
    expect(line).not.toMatch(/cost=\$0(\.0+)?$/)
  })

  it('prints six significant digits with trailing zeros trimmed', () => {
    const usage = usageOf(finished({ usage: { inputTokens: 1, outputTokens: 1 }, cost: { amountUsd: 0.0123456789 } }), MODEL)
    expect(formatUsageLine('control', usage)).toBe(`theoclaw: usage control ${MODEL} in=1 out=1 cost=$0.0123457`)
    const round = usageOf(finished({ cost: { amountUsd: 0.5 } }), MODEL)
    expect(formatUsageLine('control', round)).toBe(`theoclaw: usage control ${MODEL} in=0 out=0 cost=$0.5`)
  })
})

describe('formatUsageFooter', () => {
  const priced = usageOf(finished({ usage: { inputTokens: 120, outputTokens: 30 }, cost: { amountUsd: 0.00042 } }), MODEL)
  const unpriced = usageOf(finished({ usage: { inputTokens: 120, outputTokens: 30 } }), MODEL)

  it('tokens mode shows the token counts', () => {
    expect(formatUsageFooter('tokens', priced)).toBe('— 120 in · 30 out')
  })

  it('cost mode shows the amount, or that the run was unpriced', () => {
    expect(formatUsageFooter('cost', priced)).toBe('— $0.00042')
    expect(formatUsageFooter('cost', unpriced)).toBe('— cost unpriced')
  })

  it('full mode shows the tokens, the cost and the model', () => {
    expect(formatUsageFooter('full', priced)).toBe(`— 120 in · 30 out · $0.00042 · ${MODEL}`)
    expect(formatUsageFooter('full', unpriced)).toBe(`— 120 in · 30 out · cost unpriced · ${MODEL}`)
  })
})
