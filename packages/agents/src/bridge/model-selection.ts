/**
 * Model-selection mapping (M1 reasoning-visibility) — the single site that turns a
 * provider-agnostic `ReasoningEffort` into the SDK `ModelSelection`. Kept in its own small module
 * (not inside `sdk-adapter.ts`) so the adapter stays under the G6 500-LoC budget and the helper has
 * a focused home (per the plan's T1.1 "or a small sibling").
 */
import type { ModelSelection } from '@theokit/sdk'

import type { ReasoningEffort } from '../types.js'

/**
 * Build the SDK `ModelSelection` for a model id + optional reasoning effort. With no (or empty)
 * effort it returns the bare `{ id }` — byte-identical to the prior behavior (backward-compat). With
 * an effort it adds the canonical reasoning param `{ id: 'thinking', value: effort }`. Pure.
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
  return { ...base, params: [...(base.params ?? []), { id: 'thinking', value: effort }] }
}
