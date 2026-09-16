/**
 * Phase 1.1 — three groups of keys, and the third one is why this file exists.
 *
 * `settings.json` replaces `config.toml`, and the filename is Claude Code's. So a real Claude Code
 * settings file will be pasted into it, and both schemas here are `.strict()`: without this, the
 * product refuses to start over `spinnerTipsEnabled`.
 *
 * The groups: ours (parsed), theirs (recognised, ignored, reported), neither (rejected). Dropping
 * the third would mean accepting anything, which teaches people a key is read when it is not — the
 * failure `#91` documents for rules and `#120` documents for pins.
 *
 * THESE CASES MOVED TO `translateSettings` ON 2026-09-10, and the move is the finding. They used to
 * drive `foreignKeysIn` and `withoutForeignKeys`, two exported helpers whose only caller was this
 * file. `translateSettings` had taken over the job and does it differently — it normalises spelling
 * through `SAME_SETTING_DIFFERENT_SPELLING` first, separates a foreign root from ours, and leaves
 * unknown keys in place for the strict schema to name. So the helpers were not merely unused: they
 * were a SECOND implementation of a live rule, returning a different answer from the one production
 * gives, with tests that went on passing over it. Deleted; the assertions point at the real path.
 */
import { describe, expect, it } from 'vitest'

import { FOREIGN_SETTINGS_KEYS } from '../../src/config/foreign-keys.js'
import { translateSettings } from '../../src/config/settings-json.js'

const OURS = [
  'model', 'reasoning_effort', 'sandbox_mode', 'approval_policy', 'goal_oracle', 'skills',
  'hooks', 'memory', 'home_dir', 'shell_timeout_ms', 'session_gc', 'context_window',
  'profile', 'profiles',
]

// `hooksDelivery: 'ours'` because these cases are about the KEY partition, not about hooks: it is
// the setting that leaves hook translation on our own path, so no case here depends on it.
const read = (raw: unknown, foreignRoot = false) =>
  translateSettings(raw, { ownKeys: OURS, foreignRoot, hooksDelivery: 'ours' })

describe('Phase 1.1 — keys this product recognises and does not act on', () => {
  it('test_a_foreign_key_is_reported_not_silently_dropped', () => {
    // The whole point. An ignored key must still be nameable, or the operator cannot tell a setting
    // that is unsupported from one that is misspelt.
    const out = read({ spinnerTipsEnabled: true, model: 'openai/x' })
    expect(out.ignored).toEqual(['spinnerTipsEnabled'])
    expect(out.values).toEqual({ model: 'openai/x' })
  })

  it('test_a_typo_of_OUR_key_is_neither_group_so_the_schema_still_rejects_it', () => {
    // The arm that killed the heuristic. "camelCase is theirs, snake_case is ours" would classify
    // `sandboxMode` as foreign and ignore it silently — the exact defect strictness prevents.
    // An explicit list leaves it in neither group, so it reaches `.strict()` and throws naming itself.
    expect(FOREIGN_SETTINGS_KEYS.has('sandboxMode')).toBe(false)
    const out = read({ sandboxMode: 'read-only' })
    expect(out.ignored).toEqual([])
    expect(out.values).toEqual({ sandboxMode: 'read-only' })
  })

  it('test_an_unknown_key_in_THEIR_file_is_named_rather_than_absorbed', () => {
    // The distinction the deleted helpers could not make, and the reason retargeting was not a
    // like-for-like move: under a foreign root an unknown key is tolerated AND reported, instead of
    // being left to blow up a schema that was never meant to read their file.
    expect(read({ someKeyNobodyHas: 1 }, true).unrecognised).toEqual(['someKeyNobodyHas'])
  })

  it('test_no_key_of_ours_was_put_on_the_foreign_list', () => {
    // Anti-vacuity, and the direction that would be worst: a key of ours on this list is a setting
    // silently ignored before the parser ever sees it, so it would read as accepted and do nothing.
    for (const ours of OURS) {
      expect(FOREIGN_SETTINGS_KEYS.has(ours), `"${ours}" is ours and is on the foreign list`).toBe(
        false,
      )
    }
  })

  it('test_hostile_input_is_skipped_rather_than_thrown_on', () => {
    // The file crosses from disk and may be anything a text editor can produce.
    expect(read(null).values).toEqual({})
    expect(read('not an object').ignored).toEqual([])
  })
})
