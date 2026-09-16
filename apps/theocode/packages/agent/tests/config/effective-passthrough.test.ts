/**
 * Every scalar the schema declares must survive the class that wraps it.
 *
 * Found by mutation, not by reading: replacing `this.shell_timeout_ms = cfg.shell_timeout_ms` with
 * the DEFAULT killed no test. `shell-timeout.test.ts` exercises `resolveConfig`, which returns the
 * plain object; `EffectiveConfig` is a separate hop, and it is the one `commands/review.ts` and
 * `config-commands.ts` actually read. A knob could be pinned to its default at that boundary and the
 * whole chain — file, env, CLI override — would keep passing.
 *
 * DERIVED from `CONFIG_SCHEMA_KEYS` rather than retyped, for the reason B-135 recorded: a
 * hand-copied list of keys drifts from the schema and the test goes on reporting a surface that no
 * longer exists. A key added without a value here fails the first case rather than being skipped in
 * silence.
 */
import { describe, expect, it } from 'vitest'

import { CONFIG_SCHEMA_KEYS, resolveConfig, type SchemaKey } from '../../src/config/config.js'
import { EffectiveConfig } from '../../src/config/effective-config.js'

/**
 * A value per key that is NOT the default — that is the whole point. A passthrough replaced by its
 * default is invisible to a test that passes the default in.
 */
const NON_DEFAULT: Record<SchemaKey, unknown> = {
  model: 'openai/gpt-5-mini',
  reasoning_effort: 'high',
  sandbox_mode: 'read-only',
  approval_policy: 'never',
  goal_oracle: 'update_goal',
  skills: ['something-else'],
  hooks: [{ event: 'Stop', command: 'true' }],
  memory: true,
  home_dir: '.theocode',
  shell_timeout_ms: 45_000,
  session_gc: false,
  context_window: 123_456,
  output_style: 'terse',
}

describe('EffectiveConfig carries what the schema declared', () => {
  it('test_every_schema_key_has_a_non_default_value_to_check', () => {
    // The derivation guard. Without it, adding a key to the schema would silently leave it
    // unchecked below — which is the exact drift B-135 found in env-knobs.test.ts.
    expect(Object.keys(NON_DEFAULT).sort()).toEqual([...CONFIG_SCHEMA_KEYS].sort())
  })

  it.each(
    CONFIG_SCHEMA_KEYS.filter((k) => k !== 'context_window' && k !== 'skills' && k !== 'hooks'),
  )('test_%s_survives_the_wrapper', (key) => {
    const resolved = resolveConfig({ user: { [key]: NON_DEFAULT[key] } as never })
    const effective = new EffectiveConfig(resolved)

    expect(
      (effective as unknown as Record<string, unknown>)[key],
      `${key} was declared, resolved, and then dropped or defaulted by EffectiveConfig`,
    ).toEqual(NON_DEFAULT[key])
  })

  it('test_the_frozen_collections_survive_too', () => {
    // skills and hooks are copied and frozen rather than assigned, so they are checked apart —
    // the copy is what could silently drop a member.
    const effective = new EffectiveConfig(
      resolveConfig({ user: { skills: ['something-else'], hooks: [{ event: 'Stop' }] } as never }),
    )

    expect(effective.skills).toEqual(['something-else'])
    expect(effective.hooks).toHaveLength(1)
    expect(Object.isFrozen(effective.skills), 'a caller can mutate the resolved config').toBe(true)
  })

  it('test_a_declared_context_window_reaches_its_getter', () => {
    // Private field, read through `declaredWindow` — the same passthrough, one indirection further.
    const effective = new EffectiveConfig(resolveConfig({ user: { context_window: 123_456 } }))

    expect(effective.declaredWindow).toBe(123_456)
  })
})
