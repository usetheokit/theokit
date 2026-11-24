import { describe, expect, it } from 'vitest'

import { BUILTIN_COMMAND_NAMES, commandPalette, routeCommand } from '../../src/commands/registry.js'

describe('routeCommand — a mistyped command is not prose', () => {
  it('test_an_unknown_slash_command_is_an_error_not_a_message', () => {
    // The defect this migration closes, and the framework's own docblock states it: "sending
    // `/moddel gpt-5` to the model as text hides a typo behind a plausible answer".
    //
    // The local router ended `EXACT_COMMANDS.get(trimmed) ?? { kind: 'send', text: trimmed }`, so
    // every unrecognised slash went to the model as prose. The model, being helpful, answers — and
    // the user reads a plausible reply to a command that never ran.
    //
    // Plain text stays a MESSAGE: a terminal that answered "unknown command" to ordinary prose
    // would be unusable. A leading `/` is an explicit claim to be a command.
    const routed = routeCommand('/moddel gpt-5')

    expect(routed.kind).not.toBe('send')
    expect(routed).toMatchObject({ kind: 'commandError', reason: 'unknown-command' })
  })

  it('test_prose_is_still_a_message', () => {
    expect(routeCommand('what does /moddel do?')).toEqual({
      kind: 'send',
      text: 'what does /moddel do?',
    })
  })

  it('test_a_known_command_still_routes_to_its_verb', () => {
    // Anti-regression: the failure classes are additive, not a rewrite of what already worked.
    expect(routeCommand('/model gpt-5')).toEqual({ kind: 'model', arg: 'gpt-5' })
    expect(routeCommand('/clear')).toEqual({ kind: 'clear' })
  })
})

describe('the names Codex answers to also answer here', () => {
  it('test_exit_is_an_alias_of_quit_and_not_an_unknown_command', () => {
    // Codex routes BOTH `/quit` and `/exit` to the same verb. Someone arriving from it types
    // whichever they have in their fingers, and the one we lacked produced an unknown-command
    // error on the way OUT of a session — the least forgiving moment to be pedantic about a
    // synonym. Asserted as equality with `/quit` so the two can never drift into different verbs.
    expect(routeCommand('/exit')).toEqual(routeCommand('/quit'))
    expect(routeCommand('/exit')).toEqual({ kind: 'quit' })
  })

  it('test_pwd_answers_which_directory_this_session_is_in', () => {
    expect(routeCommand('/pwd')).toEqual({ kind: 'pwd' })
  })

  it('test_both_are_offered_by_the_slash_menu', () => {
    // Routable but unlisted is the state `composerCommands` exists to prevent: a command
    // discoverable only by already knowing it is not discoverable.
    expect(BUILTIN_COMMAND_NAMES.has('exit'), '/exit is routable but absent from the menu').toBe(
      true,
    )
    expect(BUILTIN_COMMAND_NAMES.has('pwd'), '/pwd is routable but absent from the menu').toBe(true)
  })
})

describe('aliases, hidden names and custom shadowing come from the framework registry', () => {
  it('test_a_custom_command_shadowing_a_canonical_name_wins_and_the_alias_still_quits', () => {
    expect(routeCommand('/quit', new Set(['quit']))).toEqual({
      kind: 'custom',
      name: 'quit',
      arg: '',
    })
    expect(routeCommand('/exit', new Set(['quit']))).toEqual({ kind: 'quit' })
  })

  it('test_a_custom_command_shadowing_an_alias_wins_over_it', () => {
    expect(routeCommand('/exit now', new Set(['exit']))).toEqual({
      kind: 'custom',
      name: 'exit',
      arg: 'now',
    })
    expect(routeCommand('/quit', new Set(['exit']))).toEqual({ kind: 'quit' })
  })

  it('test_a_custom_command_shadowing_a_codex_name_wins', () => {
    expect(routeCommand('/memories', new Set(['memories']))).toEqual({
      kind: 'custom',
      name: 'memories',
      arg: '',
    })
  })
})

describe('commandPalette', () => {
  it('test_every_visible_entry_has_a_description_and_hidden_codex_names_are_absent', () => {
    const palette = commandPalette(new Map())
    expect(palette.every((c) => c.description.length > 0)).toBe(true)
    const names = palette.map((c) => c.name)
    expect(names).toEqual(expect.arrayContaining(['clear', 'quit', 'exit', 'memories']))
    expect(names).not.toContain('pets')
    expect(new Set(names).size).toBe(names.length)
  })

  it('test_a_custom_command_replaces_the_builtin_it_shadows_and_carries_its_description', () => {
    const palette = commandPalette(new Map([['quit', { name: 'quit', description: 'mine' }]]))
    expect(palette.filter((c) => c.name === 'quit')).toEqual([
      { name: 'quit', description: 'mine' },
    ])
    expect(palette.some((c) => c.name === 'exit')).toBe(true)
    expect(routeCommand('/quit', new Set(['quit']))).toEqual({
      kind: 'custom',
      name: 'quit',
      arg: '',
    })
  })
})

describe('verbs shared with the framework session vocabulary', () => {
  it('keeps arguments optional and adds no alias the product did not have', () => {
    expect(routeCommand('/clear')).toEqual({ kind: 'clear' })
    expect(routeCommand('/model')).toMatchObject({ kind: 'model' })
    expect(routeCommand('/reset').kind).toBe('commandError')
    expect(routeCommand('/new chat').kind).not.toBe('commandError')
  })
})
