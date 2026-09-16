/**
 * Phase 1 — `settings.json` is the configuration file, and it is Claude Code's filename.
 *
 * Every case below comes from a shape measured on disk in this repository on 2026-09-07, not from
 * a shape imagined for a test: `.claude/settings.json` here carries six hook events, two of which
 * this product does not have, `matcher: "*"`, and timeouts in seconds.
 */
import { describe, expect, it } from 'vitest'

import { CONFIG_SCHEMA_KEYS } from '../../src/config/config.js'

/** Reading a file under `.claude/` — their vocabulary, so an unknown key is tolerated and named. */
const THEIRS = { ownKeys: CONFIG_SCHEMA_KEYS, foreignRoot: true, hooksDelivery: 'sdk' } as const
/** Reading a file under this product's own root — an unknown key here is a typo. */
const OURS = { ownKeys: CONFIG_SCHEMA_KEYS, foreignRoot: false, hooksDelivery: 'ours' } as const

/** Held in a variable, not a literal: the point is that it throws at RUNTIME, and a literal here is
 * flagged statically as an invalid regex — which is the very fact being asserted. */
const MATCH_ALL_IN_THEIR_DIALECT = '*'
import { translateSettings, translateForeignHooks } from '../../src/config/settings-json.js'

describe('hooks — the two dialects, and the four ways the foreign one breaks ours', () => {
  it('test_the_foreign_nested_shape_becomes_our_flat_one', () => {
    const { hooks } = translateForeignHooks({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }],
    })
    expect(hooks).toEqual([{ event: 'PreToolUse', command: 'guard.sh', matcher: 'Bash' }])
  })

  it('test_timeout_is_seconds_there_and_milliseconds_here', () => {
    // The failure this prevents is silent and total: forwarding 30 as `timeout_ms` gives every
    // hook 30ms, so each one is killed before its interpreter starts and the product reports
    // hook failures for hooks that are fine.
    const { hooks } = translateForeignHooks({
      Stop: [{ hooks: [{ type: 'command', command: 'check.sh', timeout: 120 }] }],
    })
    expect(hooks[0]).toMatchObject({ timeout_ms: 120_000 })
  })

  it('test_star_matcher_becomes_match_all_and_is_never_forwarded', () => {
    // `matcher: "*"` is idiomatic there and is not a regex: `new RegExp('*')` throws, and
    // `requireCompilableMatcher` turns that into a HookError at boot. Measured in this repo's own
    // `.claude/settings.json`, on PreCompact.
    const star: string = MATCH_ALL_IN_THEIR_DIALECT
    // Measured, not inferred: node throws `SyntaxError: Invalid regular expression: /*/: Nothing to
    // repeat`. `requireCompilableMatcher` turns exactly this into a HookError at boot.
    expect(() => new RegExp(star)).toThrow(/Nothing to repeat/)
    const { hooks } = translateForeignHooks({
      PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'lint.sh' }] }],
    })
    expect(hooks[0]).not.toHaveProperty('matcher')
  })

  it('test_an_event_we_do_not_have_is_dropped_by_name_not_thrown_on', () => {
    // This repository's own file has `UserPromptSubmit` and `PreCompact`; we have four events.
    // Throwing would make a valid Claude Code file unable to start this product; dropping in
    // silence would make an operator believe a hook runs. So: dropped, and named.
    const { hooks, dropped } = translateForeignHooks({
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'inject.sh' }] }],
      Stop: [{ hooks: [{ type: 'command', command: 'check.sh' }] }],
    })
    expect(hooks.map((h) => h.event)).toEqual(['Stop'])
    expect(dropped.join(' ')).toContain('UserPromptSubmit')
  })

  it('test_a_non_command_hook_is_dropped_by_name', () => {
    const { hooks, dropped } = translateForeignHooks({
      Stop: [{ hooks: [{ type: 'prompt', prompt: 'summarise' }] }],
    })
    expect(hooks).toEqual([])
    expect(dropped.join(' ')).toContain('prompt')
  })

  it('test_one_group_fans_out_to_one_entry_per_command', () => {
    // Measured: PostToolUse here holds one matcher group with three commands under it.
    const { hooks } = translateForeignHooks({
      PostToolUse: [
        {
          matcher: 'Edit|Write',
          hooks: [
            { type: 'command', command: 'a.sh' },
            { type: 'command', command: 'b.sh' },
            { type: 'command', command: 'c.sh' },
          ],
        },
      ],
    })
    expect(hooks).toHaveLength(3)
    expect(hooks.every((h) => h.matcher === 'Edit|Write')).toBe(true)
  })

  it('test_a_flat_array_under_our_own_root_is_refused', () => {
    // #144 — this used to assert the opposite, and the opposite refused every turn. `.theokit/` is
    // the SDK's filebase, so its own settings loader reads this same file and rejects any shape but
    // the nested one. The flat array is the internal shape, never a shape a `settings.json` carries.
    expect(() =>
      translateSettings({ hooks: [{ event: 'Stop', command: 'check.sh' }] }, OURS),
    ).toThrow(/hooks/)
  })
})

describe('the whole file', () => {
  it('test_a_real_claude_code_settings_file_does_not_prevent_starting', () => {
    const real = {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      alwaysThinkingEnabled: true,
      statusLine: { type: 'command', command: 'x' },
      permissions: { allow: ['Bash'] },
      env: { FOO: 'bar' },
      model: 'openai/gpt-5',
    }
    const read = translateSettings(real, THEIRS)
    expect(read.values).toEqual({ model: 'openai/gpt-5' })
    expect(read.ignored).toContain('alwaysThinkingEnabled')
    expect(read.ignored).toContain('$schema')
  })

  it('test_no_key_of_ours_starts_with_an_underscore_which_is_what_the_comment_rule_rests_on', () => {
    // The comment convention (`_comment_`) is recognised by shape. That is only safe while no key
    // of this product's own schema begins with `_`; if one ever does, this fails and says why.
    expect(CONFIG_SCHEMA_KEYS.filter((k) => k.startsWith('_'))).toEqual([])
  })

  it('test_a_key_that_is_neither_ours_nor_theirs_survives_so_the_schema_rejects_it', () => {
    // `sandboxMode` is a camelCase typo of our `sandbox_mode`. Passing it through is what makes
    // the strict schema able to name it; swallowing it is the defect strictness exists to prevent.
    const read = translateSettings({ sandboxMode: 'read-only' }, OURS)
    expect(read.ignored).not.toContain('sandboxMode')
    expect(read.values).toHaveProperty('sandboxMode')
  })

  it('test_a_key_in_neither_vocabulary_is_tolerated_and_named_under_THEIR_root', () => {
    // The arm the 141-key inventory failed on. `voiceEnabled` was a real key on a real machine that
    // the inventory did not know, and it stopped eight tests from starting. Under their root the
    // answer must not depend on whether we happened to have written the key down.
    const read = translateSettings({ voiceEnabled: true, model: 'openai/x' }, THEIRS)
    expect(read.values).toEqual({ model: 'openai/x' })
    expect(read.unrecognised).toEqual(['voiceEnabled'])
  })

  it('test_the_same_key_under_OUR_root_reaches_the_schema_instead', () => {
    // Negative control on the provenance rule: without this arm, tolerating everything everywhere
    // would pass the test above just as well.
    expect(translateSettings({ voiceEnabled: true }, OURS).values).toHaveProperty('voiceEnabled')
  })

  it('test_hostile_input_does_not_throw', () => {
    expect(translateSettings(null, OURS).values).toEqual({})
    expect(translateSettings('nope', OURS).values).toEqual({})
    expect(translateForeignHooks(null).hooks).toEqual([])
  })
})
