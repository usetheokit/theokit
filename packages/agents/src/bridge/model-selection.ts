/**
 * Model-selection mapping (M1 reasoning-visibility) — the single site that turns a
 * provider-agnostic `ReasoningEffort` into the SDK `ModelSelection`. Kept in its own small module
 * (not inside `sdk-adapter.ts`) so the adapter stays under the G6 500-LoC budget and the helper has
 * a focused home (per the plan's T1.1 "or a small sibling").
 */
import type { ModelSelection } from '@theokit/sdk'

import type { ReasoningEffort } from '../types.js'

/**
 * The canonical reasoning parameter key — ONE owner for BOTH directions.
 *
 * M107: the write lived here and the read lived in the consumer, spelled out by hand. Two copies of
 * this literal are the second oracle over one fact, and the two sides drift apart silently — so the
 * inverse below shares this constant instead of re-declaring the string.
 *
 * Deliberately NOT exported: the three reference peers make the key unreachable to the consumer by
 * type, and once both directions exist nobody needs the literal. Exporting it would invite hand-built
 * params, which is exactly what these two functions exist to eliminate.
 */
const PARAM_THINKING = 'thinking'

/**
 * Build the SDK `ModelSelection` for a model id + optional reasoning effort. With no (or empty)
 * effort it returns the bare `{ id }` — byte-identical to the prior behavior (backward-compat). With
 * an effort it adds the canonical reasoning param `{ id: PARAM_THINKING, value: effort }`. Pure.
 */
export function buildModelSelection(
  model: string | ModelSelection,
  effort?: ReasoningEffort,
): ModelSelection {
  // M95 (revisão adversarial do M94, BLOCKER) — `model` pode chegar como `ModelSelection`.
  //
  // O M94 alargou `AgentBuilder.model()` para aceitar a seleção completa, e parou aí: este site,
  // por onde cada turno passa, seguia assumindo `string` e produzia `{ id: {id, …} }` — um
  // objeto onde o runtime espera um id, e o primeiro `modelId.indexOf('/')` adiante quebrava
  // cada turno com `context_window` configurado.
  //
  // Alargar o tipo sem alargar o runtime é a mesma divergência fachada↔implementação que o M94
  // veio corrigir, só que na direção oposta. Aqui os campos da seleção são preservados, e o
  // `effort` compõe com os `params` que já vieram em vez de descartá-los.
  const base: ModelSelection = typeof model === 'string' ? { id: model } : { ...model }
  if (!effort) return base
  return { ...base, params: [...(base.params ?? []), { id: PARAM_THINKING, value: effort }] }
}

/**
 * Read the reasoning effort back out of a model selection — the inverse of
 * {@link buildModelSelection}, and the reason this module owns the param key.
 *
 * Returns `undefined` when there is no effort to read: a bare-string model id (no params to carry
 * one), a selection without `params`, or params that do not include the reasoning key. Absence is a
 * DECLARED state, not an exceptional one, so none of those throw.
 *
 * A present-but-unrecognised value is returned VERBATIM. Validating it belongs to the caller (which
 * already has its own parser); hijacking that here would widen the layer's responsibility with
 * nobody asking. Pure.
 *
 * The return is `string`, not {@link ReasoningEffort}, precisely BECAUSE the value is unvalidated:
 * whatever is in the document comes back, and typing it as the semi-closed union would promise a
 * check this function deliberately does not perform. Assigning the result to a `ReasoningEffort` is
 * the caller's decision, after the caller's own parse.
 */
export function reasoningEffortOf(model: string | ModelSelection): string | undefined {
  // Um único `return`: o atalho de id em string simplesmente não tem params onde um esforço possa
  // estar, e tratá-lo como "lista ausente" evita um segundo ponto de saída com o mesmo significado.
  //
  // Resíduo declarado (M107): esta guarda é de TIPO, não de runtime — nenhum teste pode matá-la,
  // porque ler `.params` de uma string primitiva já devolve `undefined` (medido). Quem a enforça é
  // `tsc --noEmit`: sem ela, `model.params` não compila sobre `string | ModelSelection`. Uma mutação
  // que a remova sobrevive à suíte por EQUIVALÊNCIA, não por falta de cobertura.
  const params = typeof model === 'string' ? undefined : model.params
  return params?.find((p) => p.id === PARAM_THINKING)?.value
}
