/**
 * A name Codex answers to should not be an error here.
 *
 * The gap was measured against `codex-rs/tui/src/slash_command.rs` on 2026-08-25: of the Codex
 * command set, roughly thirty names produced `unknown command` in this build. That error is
 * accurate and useless — it says the word was wrong without saying what the right word is, and for
 * half of them there IS a right word here (`/memories` → `/memory`).
 *
 * These tests fix the CONTRACT, not the wording: every mapped name routes rather than erroring,
 * every answer names something, and the menu stays free of entries that only advertise an absence.
 *
 * The contract cuts both ways, and `test_no_pointer_is_declared_for_a_name_this_build_implements`
 * is the half that matters as the gap closes: `/theme`, `/agents` and `/permissions` are real
 * commands now, and leaving their pointers behind would have left three menu entries telling a
 * user to go somewhere else instead of running.
 */
import { describe, expect, it } from 'vitest'

import { CODEX_NAMES, CODEX_NAME_COMMANDS, codexNameAnswer } from '../../src/commands/codex-names.js'
import { BUILTIN_COMMAND_NAMES, routeCommand } from '../../src/commands/registry.js'

describe('a Codex name is answered, not refused', () => {
  it('test_every_mapped_name_routes_instead_of_erroring', () => {
    // The whole point. `commandError` is what each of these used to produce.
    for (const name of CODEX_NAMES.keys()) {
      expect(routeCommand(`/${name}`), `/${name} still errors`).toEqual({
        kind: 'codexName',
        name,
      })
    }
  })

  it('test_a_name_with_no_menu_entry_is_still_answered_when_typed', () => {
    // Discovery and forgiveness are different jobs. `/pets` is deliberately absent from the menu
    // and must still answer, because someone arriving from Codex types it before reading a menu.
    expect(BUILTIN_COMMAND_NAMES.has('pets'), 'an absence was advertised in the menu').toBe(false)
    expect(routeCommand('/pets')).toEqual({ kind: 'codexName', name: 'pets' })
    expect(codexNameAnswer('pets')).toContain('pets')
  })

  it('test_every_answer_says_something', () => {
    // An empty or bare-name answer would be the silent-toast failure this file exists to remove.
    for (const name of CODEX_NAMES.keys()) {
      const answer = codexNameAnswer(name)

      expect(answer.startsWith(`/${name} — `), `/${name} has no answer body`).toBe(true)
      expect(answer.length, `/${name}'s answer is too short to be one`).toBeGreaterThan(
        `/${name} — `.length + 10,
      )
    }
  })

  it('test_the_menu_offers_only_the_names_that_point_at_a_real_feature', () => {
    const listed = new Set(CODEX_NAME_COMMANDS.map((c) => c.name))

    expect(listed.has('memories'), 'a name with a real equivalent is hidden from the menu').toBe(
      true,
    )
    for (const dead of ['pets', 'vim', 'ide', 'experimental']) {
      expect(listed.has(dead), `${dead} advertises an absence in the menu`).toBe(false)
    }
  })
})

describe("this build's own verbs are not shadowed", () => {
  it('test_a_name_we_actually_implement_keeps_its_real_action', () => {
    // The ordering rule in `routeCommand`: own verbs first, pointers second. Without it a pointer
    // added for a name we later implement would quietly replace the implementation.
    expect(routeCommand('/status')).toEqual({ kind: 'showStatus' })
    expect(routeCommand('/sandbox')).toEqual({ kind: 'sandbox', arg: '' })
    expect(routeCommand('/review')).toEqual({ kind: 'review', arg: '' })
  })

  it('test_a_codex_name_that_became_a_real_command_no_longer_answers_with_a_pointer', () => {
    // The six that were promoted. Each used to route to `codexName` and produce a toast naming
    // other commands; a pointer surviving here is a command that stopped running.
    expect(routeCommand('/theme')).toEqual({ kind: 'theme', arg: '' })
    expect(routeCommand('/theme light')).toEqual({ kind: 'theme', arg: 'light' })
    expect(routeCommand('/agents')).toEqual({ kind: 'showAgents' })
    expect(routeCommand('/permissions')).toEqual({ kind: 'showPermissions' })
    expect(routeCommand('/title')).toEqual({ kind: 'title', arg: '' })
    expect(routeCommand('/title model dir')).toEqual({ kind: 'title', arg: 'model dir' })
    expect(routeCommand('/statusline')).toEqual({ kind: 'statusline', arg: '' })
    expect(routeCommand('/raw')).toEqual({ kind: 'raw', arg: '' })
    expect(routeCommand('/raw all')).toEqual({ kind: 'raw', arg: 'all' })
    for (const promoted of ['theme', 'agents', 'permissions', 'title', 'statusline', 'raw']) {
      expect(CODEX_NAMES.has(promoted), `${promoted} still has a pointer entry`).toBe(false)
    }
  })

  it('test_the_three_newest_promotions_are_advertised_in_the_menu', () => {
    // `/raw` in particular: it USED to be a listed pointer, so losing its map entry without adding
    // a command entry would have removed it from the `/` menu — a feature that got better and
    // harder to find in the same commit.
    for (const promoted of ['title', 'statusline', 'raw']) {
      expect(BUILTIN_COMMAND_NAMES.has(promoted), `${promoted} is implemented but hidden`).toBe(
        true,
      )
    }
  })

  it('test_no_pointer_is_declared_for_a_name_this_build_implements', () => {
    // Anti-drift: implementing one of these for real must not leave the pointer behind. The
    // ordering makes a stale pointer harmless, and this makes it visible.
    const ownVerbs = new Set(
      [...BUILTIN_COMMAND_NAMES].filter((n) => !CODEX_NAME_COMMANDS.some((c) => c.name === n)),
    )
    const shadowed = [...CODEX_NAMES.keys()].filter((n) => ownVerbs.has(n))

    expect(
      shadowed,
      `these names are both implemented and pointed at: ${shadowed.join(', ')}`,
    ).toEqual([])
  })

  it('test_a_codex_name_whose_feature_exists_here_is_never_an_error', () => {
    // The map exists so a Codex user finds the feature we DO have. A name we answer with
    // `unknown command` while shipping the capability under another verb is the exact
    // discovery failure the map was built to close — worse than a missing feature, because
    // the user concludes we lack something that is one word away.
    // B-158 — these were the enum VARIANT names (`MultiAgents`, `ElevateSandbox`,
    // `SandboxReadRoot`), which Codex never exposes: each carries a `#[strum(...)]` override and
    // the user types the override. Answering `multi-agents` helped nobody and left `subagents`,
    // which a Codex user actually types, unpointed. `tools/check-codex-parity.mjs` found all three.
    const withEquivalent = ['subagents', 'setup-default-sandbox', 'sandbox-add-read-dir']

    const unanswered = withEquivalent.filter((n) => routeCommand(`/${n}`).kind === 'commandError')

    expect(
      unanswered,
      `these Codex names have a real equivalent here but still error: ${unanswered.join(', ')}`,
    ).toEqual([])
  })

  it('test_an_unknown_name_is_still_an_error', () => {
    // Anti-vacuity: the pointer map must not turn every typo into a friendly answer.
    expect(routeCommand('/moddel')).toMatchObject({ kind: 'commandError' })
  })
})
