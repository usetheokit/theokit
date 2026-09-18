import { describe, expect, it } from 'vitest'

import { permissionRulesFromSettings } from '../../src/config/settings-permissions.js'

/**
 * A specifier addresses the tool's OWN argument, or the entry is reported rather than rendered.
 *
 * `translate` matched every specifier against `args.command`, because that is the field in the SDK
 * docblock's worked example. The docblock said plainly what follows — "a specifier for a tool whose
 * argument is named something else would therefore not match" — and the translator rendered those
 * entries anyway.
 *
 * Measured 2026-09-17 end to end: `Read(./off-limits.txt)` produced
 * `{ tool: 'Read', args: { command: /../ }, action: 'deny' }`, the plugin carried it, and the file
 * was read. `Read` takes `path`. A matcher on a field the tool does not have can never fire, which
 * is the failure this module's own reason-strings call worse than no rule at all.
 */
describe('a specifier names the tool argument it addresses', () => {
  it('test_a_known_argument_is_matched_on_that_argument', () => {
    const { rules } = permissionRulesFromSettings(
      { deny: ['Read(./off-limits.txt)'] },
      { specifierArg: { Read: 'path' } },
    )

    expect(rules).toHaveLength(1)
    expect(Object.keys(rules[0]?.args ?? {}), 'the matcher went to the wrong field').toEqual([
      'path',
    ])
  })

  it('test_an_unmapped_tool_is_reported_not_rendered', () => {
    const { rules, unsupported } = permissionRulesFromSettings(
      { deny: ['Mystery(something)'] },
      { specifierArg: { Read: 'path' } },
    )

    expect(rules).toHaveLength(0)
    expect(unsupported).toHaveLength(1)
    expect(unsupported[0]?.reason).toMatch(/argument/i)
  })

  it('test_a_bare_tool_name_needs_no_argument', () => {
    const { rules } = permissionRulesFromSettings({ deny: ['Mystery'] }, { specifierArg: {} })

    expect(rules).toEqual([{ tool: 'Mystery', action: 'deny' }])
  })

  it('test_without_the_map_nothing_changes_for_command_tools', () => {
    const { rules } = permissionRulesFromSettings({ deny: ['Bash(rm:*)'] })

    expect(Object.keys(rules[0]?.args ?? {})).toEqual(['command'])
  })
})
