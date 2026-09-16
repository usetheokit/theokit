/**
 * Tests for the config-discoverability guard.
 *
 * A key an operator can set in `config.toml` and cannot find in the README is a knob that exists and
 * cannot be discovered. Measured 2026-09-03: `context_window` and `goal_oracle` were in that state,
 * found by cross-checking the schema against the documented list rather than by reading either.
 *
 * This gate exists and its sibling — "every shipped backlog item appears in the CHANGELOG" — does
 * not, and the difference is the measurement. That invariant had 20 legitimate exceptions in 147
 * items, so mechanising it would have enforced an anti-pattern. This one has zero.
 */
import { describe, expect, it } from 'vitest'

import { cliModes, schemaKeys, undocumentedKeys } from './check-config-documented.mjs'

describe('config discoverability', () => {
  it('test_it_reads_the_keys_out_of_the_schema_source', () => {
    expect(schemaKeys("const CONFIG_SCHEMA_KEYS = ['model', 'memory'] as const")).toEqual([
      'model',
      'memory',
    ])
  })

  it('test_a_key_absent_from_the_readme_is_reported', () => {
    expect(undocumentedKeys(['model', 'goal_oracle'], 'we support `model` only')).toEqual([
      'goal_oracle',
    ])
  })

  it('test_a_key_written_as_a_toml_table_header_counts_as_documented', () => {
    // `hooks` is documented as `[[hooks]]`, which is how an operator actually writes it. A guard
    // that missed this would report a false positive on the one key whose documented form differs.
    expect(undocumentedKeys(['hooks'], 'add `[[hooks]]` to your config')).toEqual([])
  })

  it('test_a_fully_documented_schema_reports_nothing', () => {
    // Anti-vacuity: a guard that flags everything would satisfy the assertion above it.
    expect(undocumentedKeys(['model'], 'set `model` in the file')).toEqual([])
  })

  it('test_it_does_not_report_a_key_it_could_not_find_in_the_schema', () => {
    // The other anti-vacuity floor: an empty key list must not read as a clean bill of health for
    // the caller, so the parser is asserted separately above and this pins the empty case.
    expect(schemaKeys('no schema here')).toEqual([])
  })
})

describe('CLI mode discoverability', () => {
  // Same class, second surface. `doctor` was a fully user-facing command — B-081, built for support
  // sessions, exits non-zero so a script can use it — and the README described the CLI as having
  // "five modes" and did not name it. Found by counting, after counting caught the same defect in
  // the Codex parity figures.
  it('test_it_reads_the_modes_from_the_dispatch', () => {
    const src = `
      if (args.mode === 'sessions') return sessionsCommand(args)
      if (args.mode === 'doctor') return doctorCommand(args)
      switch (mode) {
        case 'review':
        case 'run':
      }`
    expect(cliModes(src).sort()).toEqual(['doctor', 'review', 'run', 'sessions'])
  })

  it('test_an_undocumented_mode_is_reported', () => {
    expect(undocumentedKeys(['run', 'doctor'], 'the `run` mode')).toEqual(['doctor'])
  })

  it('test_it_reports_nothing_when_every_mode_is_named', () => {
    // Anti-vacuity floor, matching the config half.
    expect(undocumentedKeys(['run'], 'the `run` mode')).toEqual([])
  })

  it('test_an_unparseable_dispatch_yields_no_modes_rather_than_a_pass', () => {
    expect(cliModes('nothing dispatches here')).toEqual([])
  })

  it('test_parser_outcomes_are_not_subcommands', () => {
    // `error` and `help` are what the ARGUMENT PARSER returns, not things a user types after the
    // binary: `error` means "you made a mistake" and `help` is `--help`. Counting them as modes
    // would demand the README document two words nobody can invoke.
    const src = "if (args.mode === 'error') {} if (args.mode === 'help') {} if (args.mode === 'run') {}"
    expect(cliModes(src)).toEqual(['run'])
  })

  it('test_a_mode_documented_inside_a_longer_command_counts', () => {
    // `sessions` is written `sessions gc` everywhere a reader meets it, because the bare word is not
    // a runnable command. Demanding the bare backtick would force the README to be less accurate.
    expect(undocumentedKeys(['sessions'], 'run `sessions gc` to collect')).toEqual([])
  })
})
