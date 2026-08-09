/**
 * A regression test for the BLOCKER M94's adversarial review found.
 *
 * M94 widened `AgentBuilder.model()` to accept a `ModelSelection` — and stopped there. The runtime
 * path every turn goes through, `buildModelSelection`, kept assuming `string` and produced
 * `{ id: { id: 'openrouter/x', contextWindow: 400000 } }`: an object where the SDK expects an id, and
 * the first `modelId.indexOf('/')` downstream broke the whole turn.
 *
 * Widening the type without widening the runtime is the SAME facade↔implementation divergence M94
 * came to fix, inverted. The type started allowing what the runtime did not know how to receive.
 */
import { describe, expect, it } from 'vitest'
import { buildModelSelection } from '../src/bridge/model-selection.js'

describe('M95 — ModelSelection crosses buildModelSelection', () => {
  it('a raw id stays byte-identical to the previous behaviour', () => {
    expect(buildModelSelection('openrouter/x')).toEqual({ id: 'openrouter/x' })
  })

  it('a ModelSelection is NOT nested inside `id`', () => {
    const r = buildModelSelection({ id: 'openrouter/x', contextWindow: 400_000 })
    expect(typeof r.id, 'the id became an object — this is what breaks every turn').toBe('string')
    expect(r.id).toBe('openrouter/x')
  })

  it('the declared contextWindow SURVIVES the conversion', () => {
    const r = buildModelSelection({ id: 'openrouter/x', contextWindow: 400_000 })
    expect(r.contextWindow).toBe(400_000)
  })

  it('effort composes with the params that already arrived, instead of discarding them', () => {
    const r = buildModelSelection(
      { id: 'openrouter/x', params: [{ id: 'temperature', value: '0.2' }] },
      'high',
    )
    expect(r.params).toEqual([
      { id: 'temperature', value: '0.2' },
      { id: 'thinking', value: 'high' },
    ])
  })

  it('effort over a raw id stays as it was', () => {
    expect(buildModelSelection('openrouter/x', 'high')).toEqual({
      id: 'openrouter/x',
      params: [{ id: 'thinking', value: 'high' }],
    })
  })
})
