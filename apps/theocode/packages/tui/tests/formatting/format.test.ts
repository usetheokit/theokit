import { describe, expect, it } from 'vitest'
import { fmtK } from '../../src/formatting/format.js'

describe('fmtK', () => {
  it('shows millions from one million up', () => {
    expect(fmtK(1_000_000)).toBe('1m')
    expect(fmtK(1_200_000)).toBe('1.2m')
    expect(fmtK(999_950)).toBe('1m')
  })
  it('keeps thousands as k', () => {
    expect(fmtK(999_900)).toBe('999.9k')
    expect(fmtK(1500)).toBe('1.5k')
    expect(fmtK(999)).toBe('999')
  })
})
