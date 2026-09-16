/**
 * The shell timeout is a CONFIG key, not a constant the operator cannot reach.
 *
 * `expansionDeps` in the TUI runs an ARBITRARY user command — `process.env.SHELL -c cmd` — and killed
 * it at a hard-coded 10 000 ms. A custom command that legitimately takes longer (a slow `git log`, a
 * build, a query against a remote) was truncated with no knob to raise, while the hook engine right
 * beside it had accepted a per-hook `timeout_ms` override since it shipped.
 *
 * The inconsistency was the defect, not the number: two sibling features executing operator-supplied
 * commands, one configurable and one not. The default stays 10 000 ms — this is about reachability.
 *
 * These tests pin the default, the bounds, and the fact that the key is reachable the same way every
 * other scalar is. Whether the TUI actually passes it to `execFile` is `config-commands.ts`'s
 * business and is covered there.
 */
import { describe, expect, it } from 'vitest'

import {
  CONFIG_SCHEMA_KEYS,
  DEFAULT_SHELL_TIMEOUT_MS,
  resolveConfig,
  ConfigError,
} from '../../src/config/config.js'
import { ENV_MEMORY, ENV_SESSION_GC, ENV_SHELL_TIMEOUT_MS } from '../../src/config/env-knobs.js'

describe('shell_timeout_ms is reachable', () => {
  it('test_it_defaults_to_the_documented_constant_when_nobody_configured_it', () => {
    // The default is deliberately unchanged from the constant it replaces. A fix that also moved the
    // number would have changed behaviour for every operator while claiming to add a knob.
    expect(resolveConfig({}).shell_timeout_ms).toBe(DEFAULT_SHELL_TIMEOUT_MS)
    expect(DEFAULT_SHELL_TIMEOUT_MS).toBe(10_000)
  })

  it('test_an_operator_with_a_slow_command_can_raise_it', () => {
    // The finding, in one line: this is what was impossible before.
    expect(resolveConfig({ user: { shell_timeout_ms: 60_000 } }).shell_timeout_ms).toBe(60_000)
  })

  it('test_the_project_layer_wins_over_the_user_layer_like_every_other_scalar', () => {
    expect(
      resolveConfig({ user: { shell_timeout_ms: 60_000 }, project: { shell_timeout_ms: 20_000 } })
        .shell_timeout_ms,
    ).toBe(20_000)
  })

  it('test_the_environment_reaches_it', () => {
    // env-knobs.test.ts asserts every schema key is reachable OR exempt; this asserts the reach is
    // real rather than merely registered.
    expect(
      resolveConfig({ env: { [ENV_SHELL_TIMEOUT_MS]: '45000' } }).shell_timeout_ms,
      'the environment knob is declared but does not reach the resolved config',
    ).toBe(45_000)
  })

  it('test_a_non_positive_timeout_fails_loud_instead_of_disabling_the_kill', () => {
    // Zero and negative are the dangerous values: `execFile` treats 0 as "no timeout", so a typo
    // would silently remove the bound on an arbitrary user command rather than shorten it.
    //
    // The MESSAGE is asserted, not only the type. `rules/testing.md` § 4.1 asks a negative case to
    // pin the specific typed error AND its message, and the reason bites here: a ConfigError naming
    // some other key would satisfy `toThrow(ConfigError)` while sending the operator to the wrong
    // line of their config.
    expect(() => resolveConfig({ user: { shell_timeout_ms: 0 } })).toThrow(ConfigError)
    expect(() => resolveConfig({ user: { shell_timeout_ms: 0 } })).toThrow(/shell_timeout_ms/)
    expect(() => resolveConfig({ user: { shell_timeout_ms: -1 } })).toThrow(/shell_timeout_ms/)
  })

  it('test_a_non_numeric_environment_value_is_refused_by_name', () => {
    // The uncovered half of `numberFromEnv`: anything that is not a finite number is passed THROUGH
    // as the raw string, so the schema rejects it by name instead of the knob resolving to NaN. A
    // NaN timeout is the same hazard as 0 — execFile would not bound the command — reached by a typo
    // rather than by a wrong number.
    expect(() => resolveConfig({ env: { [ENV_SHELL_TIMEOUT_MS]: 'ten seconds' } })).toThrow(
      ConfigError,
    )
    expect(() => resolveConfig({ env: { [ENV_SHELL_TIMEOUT_MS]: 'ten seconds' } })).toThrow(
      /shell_timeout_ms/,
    )
  })

  it('test_an_empty_environment_value_is_diagnosed_as_empty_not_as_a_bad_number', () => {
    // The message, not just the refusal — and the distinction is what the length check in
    // `numberFromEnv` actually buys. MEASURED both ways 2026-09-03:
    //
    //   with the guard:    "Invalid input: expected number, received string [shell_timeout_ms]"
    //   without it:        "shell_timeout_ms: must be positive — execFile reads 0 as no timeout"
    //
    // `Number('')` is 0, so without the guard an exported-but-EMPTY variable is diagnosed as a
    // non-positive NUMBER. The operator is told to fix a value they never set, which is the same
    // misdiagnosis B-137 removed from the git gate one package over.
    //
    // Asserting only `toThrow(ConfigError)` here would pass either way: zod refuses both. The
    // refusal was never the risk; the wrong explanation was.
    expect(() => resolveConfig({ env: { [ENV_SHELL_TIMEOUT_MS]: '' } })).toThrow(ConfigError)
    expect(() => resolveConfig({ env: { [ENV_SHELL_TIMEOUT_MS]: '' } })).toThrow(/received string/)
    expect(() => resolveConfig({ env: { [ENV_SHELL_TIMEOUT_MS]: '' } })).not.toThrow(
      /must be positive/,
    )
  })

  it('test_a_fractional_timeout_is_refused', () => {
    // Milliseconds are integers. Accepting 1.5 would round somewhere unstated.
    expect(() => resolveConfig({ user: { shell_timeout_ms: 1.5 } })).toThrow(ConfigError)
  })
})

/**
 * `pickScalars` copies EVERY schema key, and does so without a line per key.
 *
 * It used to be a chain of `if (raw.x !== undefined) out.x = raw.x`, one per key. That shape has a
 * silent failure mode this repository has paid for elsewhere: add a key to the schema, forget the
 * line, and the key parses, validates, and is then dropped on the floor — configurable in a file and
 * inert at runtime, with no error anywhere. It is the same drift the env-knobs detector exists to
 * catch on the environment side.
 *
 * This test is the detector for the file side: every key the schema accepts must survive the copy.
 */
describe('every schema key survives pickScalars', () => {
  const SAMPLES: Record<string, unknown> = {
    model: 'openai/some-model',
    reasoning_effort: 'high',
    sandbox_mode: 'read-only',
    approval_policy: 'never',
    goal_oracle: 'update_goal',
    skills: ['a-skill'],
    hooks: [{ event: 'Stop', command: 'true' }],
    memory: true,
    home_dir: '.theocode',
    shell_timeout_ms: 33_000,
    session_gc: false,
    context_window: 12_345,
    output_style: 'terse',
  }

  it('test_no_configured_key_is_silently_dropped', () => {
    const resolved = resolveConfig({ user: SAMPLES }) as unknown as Record<string, unknown>

    const dropped = Object.entries(SAMPLES)
      .filter(([key, value]) => JSON.stringify(resolved[key]) !== JSON.stringify(value))
      .map(([key]) => key)

    expect(dropped, 'a key parsed and validated, then never reached the resolved config').toEqual(
      [],
    )
  })

  it('test_the_sample_set_covers_the_whole_schema', () => {
    // Anti-vacuity: the test above proves nothing about a key the sample set forgot. If a key is
    // added to the schema, this fails until it is exercised above.
    expect(Object.keys(SAMPLES).sort()).toEqual([...CONFIG_SCHEMA_KEYS].sort())
  })
})

/**
 * The three boolean/numeric knobs resolve end to end, under their real names.
 *
 * Added 2026-09-03 while RE-MEASURING the findings rather than trusting they were fixed. Grepping
 * for `THEOCODE_SHELL_TIMEOUT_MS` in the source returns nothing — the names are built by template
 * (`${AB}SHELL_TIMEOUT_MS`) — so a check by text says "absent" about a knob that works. The only
 * honest verification is to resolve one.
 */
describe('the environment knobs resolve under their real names', () => {
  it('test_the_names_are_what_an_operator_would_type', () => {
    expect(ENV_SHELL_TIMEOUT_MS).toBe('THEOCODE_SHELL_TIMEOUT_MS')
    expect(ENV_SESSION_GC).toBe('THEOCODE_SESSION_GC')
    expect(ENV_MEMORY).toBe('THEOCODE_MEMORY')
  })

  it('test_each_one_reaches_the_resolved_config', () => {
    const resolved = resolveConfig({
      env: {
        [ENV_SHELL_TIMEOUT_MS]: '45000',
        [ENV_SESSION_GC]: 'off',
        [ENV_MEMORY]: 'yes',
      },
    })

    expect([resolved.shell_timeout_ms, resolved.session_gc, resolved.memory]).toEqual([
      45_000,
      false,
      true,
    ])
  })

  it('test_the_defaults_are_what_the_documentation_claims', () => {
    // README and `env-knobs.ts` both state these; a default that drifts from its own documentation
    // is the stale-measurement defect in miniature.
    const d = resolveConfig({})
    expect([d.shell_timeout_ms, d.session_gc, d.memory]).toEqual([10_000, true, false])
  })
})
