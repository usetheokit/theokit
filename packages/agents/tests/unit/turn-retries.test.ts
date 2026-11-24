import { describe, expect, it } from 'vitest'

import { createTurnRetries } from '../../src/errors/turn-retries.js'

describe('createTurnRetries', () => {
  it('reports 0 for a turn that never retried', () => {
    expect(createTurnRetries().attempts()).toBe(0)
  })

  it('keeps the highest attempt, ignores other events, and resets on startTurn', () => {
    const r = createTurnRetries()
    r.onRunEvent({ type: 'rate_limit', attempt: 1 })
    r.onRunEvent({ type: 'rate_limit', attempt: 3 })
    r.onRunEvent({ type: 'tool_progress' })
    r.onRunEvent({ type: 'rate_limit', attempt: 2 })
    r.onRunEvent({ type: 'rate_limit', attempt: 3 })
    expect(r.attempts()).toBe(3)
    r.startTurn()
    expect(r.attempts()).toBe(0)
  })

  it('ignores a zero, negative, fractional or non-numeric attempt', () => {
    const r = createTurnRetries()
    for (const attempt of [0, -1, 1.5, Number.NaN, '2', undefined]) {
      r.onRunEvent({ type: 'rate_limit', attempt } as never)
    }
    expect(r.attempts()).toBe(0)
  })

  it('does not tie onRunEvent to the object, so it can be passed bare', () => {
    const r = createTurnRetries()
    const { onRunEvent } = r
    onRunEvent({ type: 'rate_limit', attempt: 2 })
    expect(r.attempts()).toBe(2)
  })
})
