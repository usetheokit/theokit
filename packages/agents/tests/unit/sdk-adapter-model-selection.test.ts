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
describe('reasoningEffortOf (M107 — o inverso de buildModelSelection)', () => {
  it('test_ida_e_volta_preserva_o_esforco', () => {
    // A asserção mais forte da task: é ela que prova que os dois lados não divergiram.
    const niveis: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'ultra']
    for (const nivel of niveis) {
      expect(reasoningEffortOf(buildModelSelection('m', nivel))).toBe(nivel)
    }
  })

  it('test_ida_e_volta_preserva_o_esforco_com_params_preexistentes', () => {
    // `buildModelSelection` COMPÕE com os params que já vieram; a leitura tem de achar o esforço
    // mesmo quando ele não é o primeiro da lista.
    //
    // A segunda asserção fecha uma lacuna que a contraprova por mutação do M107 encontrou: o
    // docblock do M95 declara que o esforço compõe "em vez de descartá-los", e NENHUM teste
    // afirmava isso — um `buildModelSelection` que jogasse fora os params recebidos passava a
    // suíte inteira verde. Descartar `temperature` num turno é uma mudança silenciosa de
    // comportamento do provedor, que é exatamente a classe de defeito que o M95 corrigiu.
    const base: ModelSelection = { id: 'm', params: [{ id: 'temperature', value: '0.2' }] }
    const composto = buildModelSelection(base, 'high')
    expect(reasoningEffortOf(composto)).toBe('high')
    expect(composto.params).toEqual([
      { id: 'temperature', value: '0.2' },
      { id: 'thinking', value: 'high' },
    ])
  })

  it('test_selecao_sem_params_devolve_indefinido', () => {
    // Ausência de esforço é DECLARADA, não excepcional — devolve indefinido, nunca lança.
    expect(reasoningEffortOf({ id: 'm' })).toBeUndefined()
    expect(reasoningEffortOf(buildModelSelection('m'))).toBeUndefined()
  })

  it('test_selecao_com_params_sem_a_chave_devolve_indefinido', () => {
    expect(
      reasoningEffortOf({ id: 'm', params: [{ id: 'temperature', value: '0.2' }] }),
    ).toBeUndefined()
  })

  it('test_selecao_com_params_vazio_devolve_indefinido', () => {
    expect(reasoningEffortOf({ id: 'm', params: [] })).toBeUndefined()
  })

  it('test_modelo_como_string_devolve_indefinido', () => {
    // O atalho de id em string não carrega params — não há onde um esforço estar.
    expect(reasoningEffortOf('m')).toBeUndefined()
  })

  it('test_valor_nao_reconhecido_e_devolvido_cru_sem_lancar', () => {
    // Caso negativo: a validação continua sendo do consumidor (`parseEffort` no agent-builder).
    // Sequestrá-la aqui alargaria a responsabilidade da camada sem ninguém ter pedido.
    expect(reasoningEffortOf({ id: 'm', params: [{ id: 'thinking', value: 'banana' }] })).toBe(
      'banana',
    )
    expect(reasoningEffortOf({ id: 'm', params: [{ id: 'thinking', value: '' }] })).toBe('')
  })

  it('test_o_mesmo_simbolo_resolve_pela_raiz_do_barril', () => {
    expect(reasoningEffortOfDaRaiz).toBe(reasoningEffortOf)
  })
})
