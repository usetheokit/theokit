/**
 * M1 (reasoning-visibility) — T1.1: `buildModelSelection` pure unit.
 *
 * The helper is the single mapping site from a provider-agnostic `ReasoningEffort` to the SDK
 * `ModelSelection`. No effort (or empty string) ⇒ bare `{ id }` (byte-identical to prior behavior,
 * backward-compat); an effort ⇒ the canonical reasoning param `{ id: 'thinking', value: effort }`.
 */
import { describe, expect, it } from 'vitest'

import { buildModelSelection } from '../../src/bridge/model-selection.js'
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
