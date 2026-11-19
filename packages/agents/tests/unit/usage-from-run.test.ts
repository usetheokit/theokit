import { describe, expect, it } from 'vitest'

import { formatUsd, usageFromRun } from '../../src/usage/index.js'

const ctx = { model: 'm', now: () => new Date('2026-01-01') }

describe('usageFromRun', () => {
  it.each([[Number.NaN], [null], [Number.POSITIVE_INFINITY], [undefined]])(
    'a NaN, null, infinite or absent amount yields priced false (%s)',
    (amountUsd) => {
      const r = usageFromRun({ cost: { amountUsd } }, ctx)
      expect(r.priced).toBe(false)
      expect(r.costUsd).toBe(0)
    },
  )

  it('an amount of 0 yields priced true and costUsd 0', () => {
    const r = usageFromRun({ cost: { amountUsd: 0 } }, ctx)
    expect(r.priced).toBe(true)
    expect(r.costUsd).toBe(0)
  })

  it('defaults tokens, keeps cache absent, carries context', () => {
    const r = usageFromRun(
      { usage: { outputTokens: 5, cacheReadTokens: 2 } },
      { ...ctx, userId: 'u' },
    )
    expect(r).toEqual({
      userId: 'u',
      model: 'm',
      tokens: { input: 0, output: 5, cacheRead: 2 },
      costUsd: 0,
      priced: false,
      timestamp: new Date('2026-01-01'),
    })
  })
})

describe('formatUsd', () => {
  it('formatUsd prints 0.00000123 for 1.23e-6 and 12.5 for 12.5', () => {
    expect(formatUsd(1.23e-6)).toBe('0.00000123')
    expect(formatUsd(12.5)).toBe('12.5')
    expect(formatUsd(0)).toBe('0')
    expect(formatUsd(1.23e-9)).toBe('0.00000000123')
    expect(formatUsd(100)).toBe('100')
    expect(formatUsd(1234567.891)).toBe('1234570')
  })
})
