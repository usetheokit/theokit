import { describe, expect, it } from 'vitest'
import { createTurnBudget, SECURITY_FILE_MAX_TURNS, SECURITY_TURN_NEEDS } from './live/support/security-turn-budget.js'

describe('live security turn budget (NFR-005)', () => {
  it('the declared needs of every test fit the file budget', () => {
    const sum = Object.values(SECURITY_TURN_NEEDS).reduce((a, b) => a + b, 0)
    expect(sum).toBeLessThanOrEqual(SECURITY_FILE_MAX_TURNS)
  })

  it('a test spending its whole need does not take a later test its turns', () => {
    const budget = createTurnBudget({ a: 2, b: 1 })
    budget.begin('a')
    budget.spend()
    budget.spend()
    expect(() => budget.spend()).toThrow(/a ran more than 2/)
    budget.begin('b')
    expect(() => budget.spend()).not.toThrow()
    expect(budget.count()).toBe(1)
  })
})
