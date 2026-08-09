/**
 * Regressão do BLOCKER que a revisão adversarial do M94 encontrou.
 *
 * O M94 alargou `AgentBuilder.model()` para aceitar `ModelSelection` — e parou aí. O caminho de
 * runtime por onde cada turno passa, `buildModelSelection`, seguia assumindo `string` e
 * produzia `{ id: { id: 'openrouter/x', contextWindow: 400000 } }`: um objeto onde o SDK espera um
 * id, e o primeiro `modelId.indexOf('/')` adiante quebrava o turno inteiro.
 *
 * Alargar o tipo sem alargar o runtime é a MESMA divergência fachada↔implementação que o M94 veio
 * corrigir, invertida. O tipo passou a permitir o que o runtime não sabia receber.
 */
import { describe, expect, it } from 'vitest'
import { buildModelSelection } from '../src/bridge/model-selection.js'

describe('M95 — ModelSelection crosses buildModelSelection', () => {
  it('a raw id stays byte-identical to the previous behaviour', () => {
    expect(buildModelSelection('openrouter/x')).toEqual({ id: 'openrouter/x' })
  })

  it('a ModelSelection is NOT nested inside `id`', () => {
    const r = buildModelSelection({ id: 'openrouter/x', contextWindow: 400_000 })
    expect(typeof r.id, 'o id virou objeto — é isto que quebra cada turno').toBe('string')
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
