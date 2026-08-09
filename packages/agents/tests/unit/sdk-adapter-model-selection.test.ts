/**
 * M1 (reasoning-visibility) — T1.1: `buildModelSelection` pure unit.
 *
 * The helper is the single mapping site from a provider-agnostic `ReasoningEffort` to the SDK
 * `ModelSelection`. No effort (or empty string) ⇒ bare `{ id }` (byte-identical to prior behavior,
 * backward-compat); an effort ⇒ the canonical reasoning param `{ id: 'thinking', value: effort }`.
 */
import type { ModelSelection } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { buildModelSelection, reasoningEffortOf } from '../../src/bridge/model-selection.js'
import { reasoningEffortOf as reasoningEffortOfDaRaiz } from '../../src/index.js'
import type { ReasoningEffort } from '../../src/types.js'

describe('buildModelSelection (M1 reasoning-effort mapping)', () => {
  it('test_buildModelSelection_no_effort_returns_bare_id', () => {
    expect(buildModelSelection('m')).toEqual({ id: 'm' })
  })

  it('test_buildModelSelection_maps_effort_to_thinking_param', () => {
    expect(buildModelSelection('m', 'high')).toEqual({
      id: 'm',
      params: [{ id: 'thinking', value: 'high' }],
    })
  })

  it('test_buildModelSelection_each_effort_level', () => {
    const levels: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh']
    for (const level of levels) {
      expect(buildModelSelection('m', level)).toEqual({
        id: 'm',
        params: [{ id: 'thinking', value: level }],
      })
    }
  })

  it('test_buildModelSelection_empty_effort_is_bare_id', () => {
    // EC-2: an empty string is falsy ⇒ treated as "no effort" (bare id, no params), never
    // `{ params: [{ id: 'thinking', value: '' }] }` which the provider would reject.
    expect(buildModelSelection('m', '')).toEqual({ id: 'm' })
  })

  it('test_buildModelSelection_accepts_provider_specific_string', () => {
    // EC-1: the `(string & {})` arm forwards a provider-specific value verbatim (forward-compat).
    expect(buildModelSelection('m', 'ultra')).toEqual({
      id: 'm',
      params: [{ id: 'thinking', value: 'ultra' }],
    })
  })
})

/**
 * M107 T2.2 — the READ that was missing next to the write.
 *
 * `buildModelSelection` is documented as the single site of the effort → `ModelSelection` mapping,
 * and the inverse did not exist — so consumers re-derived the param key by hand
 * (`.find((p) => p.id === 'thinking')?.value`). Writing through the layer while reading by hand is a
 * second oracle over one fact, and second oracles diverge.
 */
describe('reasoningEffortOf (M107 — the inverse of buildModelSelection)', () => {
  it('test_a_round_trip_preserves_the_effort', () => {
    // A asserção mais forte da task: é ela que prova que os dois lados não divergiram.
    const niveis: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'ultra']
    for (const nivel of niveis) {
      expect(reasoningEffortOf(buildModelSelection('m', nivel))).toBe(nivel)
    }
  })

  it('test_a_round_trip_preserves_the_effort_with_pre_existing_params', () => {
    // `buildModelSelection` COMPÕE com os params que já vieram; a leitura tem de achar o esforço
    // mesmo quando ele não é o primeiro da lista.
    //
    // A segunda asserção fecha uma lacuna que a contraprova por mutação do M107 encontrou: o
    // docblock do M95 declara que o esforço compõe "em vez de descartá-los", e NENHUM teste
    // afirmava isso — um `buildModelSelection` que jogasse fora os params received passava a
    // suíte inteira verde. Descartar `temperature` num turno é uma mudança silenciosa de
    // comportamento do provedor, que é exatamente a classe de defeito que o M95 corrigiu.
    const base: ModelSelection = { id: 'm', params: [{ id: 'temperature', value: '0.2' }] }
    const composed = buildModelSelection(base, 'high')
    expect(reasoningEffortOf(composed)).toBe('high')
    expect(composed.params).toEqual([
      { id: 'temperature', value: '0.2' },
      { id: 'thinking', value: 'high' },
    ])
  })

  it('test_a_selection_with_no_params_returns_undefined', () => {
    // Ausência de esforço é DECLARADA, não excepcional — devolve indefinido, nunca lança.
    expect(reasoningEffortOf({ id: 'm' })).toBeUndefined()
    expect(reasoningEffortOf(buildModelSelection('m'))).toBeUndefined()
  })

  it('test_a_selection_with_params_but_no_key_returns_undefined', () => {
    expect(
      reasoningEffortOf({ id: 'm', params: [{ id: 'temperature', value: '0.2' }] }),
    ).toBeUndefined()
  })

  it('test_a_selection_with_empty_params_returns_undefined', () => {
    expect(reasoningEffortOf({ id: 'm', params: [] })).toBeUndefined()
  })

  it('test_a_model_given_as_a_string_returns_undefined', () => {
    // O atalho de id em string não carrega params — não há onde um esforço estar.
    expect(reasoningEffortOf('m')).toBeUndefined()
  })

  it('test_an_unrecognized_value_is_returned_raw_without_throwing', () => {
    // Caso negativo: a validação continua sendo do consumidor (`parseEffort` no agent-builder).
    // Sequestrá-la aqui alargaria a responsabilidade da camada sem ninguém ter pedido.
    expect(reasoningEffortOf({ id: 'm', params: [{ id: 'thinking', value: 'banana' }] })).toBe(
      'banana',
    )
    expect(reasoningEffortOf({ id: 'm', params: [{ id: 'thinking', value: '' }] })).toBe('')
  })

  it('test_the_same_symbol_resolves_through_the_barrel_root', () => {
    expect(reasoningEffortOfDaRaiz).toBe(reasoningEffortOf)
  })
})
