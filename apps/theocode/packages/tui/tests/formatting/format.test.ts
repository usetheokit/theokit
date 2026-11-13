import { describe, expect, it } from 'vitest'

import { fmtK } from '../../src/formatting/format.js'

describe('fmtK', () => {
  it('shows values under 1000 as-is', () => {
    expect(fmtK(0)).toBe('0')
    expect(fmtK(999)).toBe('999')
  })

  it('shows thousands with k', () => {
    expect(fmtK(1000)).toBe('1k')
    expect(fmtK(1500)).toBe('1.5k')
    expect(fmtK(999_900)).toBe('999.9k')
  })

  it('promotes to m at one million', () => {
    expect(fmtK(1_000_000)).toBe('1m')
    expect(fmtK(1_200_000)).toBe('1.2m')
    expect(fmtK(999_950)).toBe('1m')
  })
})
