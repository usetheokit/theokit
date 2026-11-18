import { describe, expect, it } from 'vitest'
import { readTurnMetadata, type WireChunk } from '../../src/wire/index.js'

const finish = (messageMetadata?: unknown) => ({ type: 'finish', messageMetadata }) as WireChunk

describe('readTurnMetadata', () => {
  it('returns usage and stopReason step_limit from a finish chunk', () => {
    expect(
      readTurnMetadata(
        finish({ usage: { inputTokens: 3, outputTokens: 4 }, stopReason: 'step_limit', model: 'm', cost: 0.5, durationMs: 9 }),
      ),
    ).toEqual({ usage: { inputTokens: 3, outputTokens: 4 }, stopReason: 'step_limit', model: 'm', cost: 0.5, durationMs: 9 })
  })

  it('returns undefined for a text-delta chunk and for a finish without metadata', () => {
    expect(readTurnMetadata({ type: 'text-delta', id: 'a', delta: 'x' } as WireChunk)).toBeUndefined()
    expect(readTurnMetadata(finish())).toBeUndefined()
  })

  it('an unknown stopReason and a non-numeric cost are dropped', () => {
    expect(
      readTurnMetadata(finish({ stopReason: 'bogus', cost: 'free', usage: { inputTokens: 'x', totalTokens: 2 } })),
    ).toEqual({ usage: { totalTokens: 2 } })
  })
})
