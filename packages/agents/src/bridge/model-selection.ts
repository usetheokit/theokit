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
export function buildModelSelection(modelId: string, effort?: ReasoningEffort): ModelSelection {
  if (!effort) return { id: modelId }
  return { id: modelId, params: [{ id: 'thinking', value: effort }] }
}
