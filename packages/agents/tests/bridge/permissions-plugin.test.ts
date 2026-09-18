import { describe, expect, it } from 'vitest'

import { createPermissionsPlugin } from '../../src/bridge/permissions-plugin.js'
import { permissionRulesFromSettings } from '../../src/config/settings-permissions.js'

/**
 * The last joint between a `permissions` block on disk and the engine that enforces it.
 *
 * `permissionRulesFromSettings` has rendered that block into `PermissionRule[]` since it was written,
 * and NOTHING consumed the result — measured across the consumer on 2026-09-17: the field is produced
 * in `settings-json.ts` and read nowhere. So an operator's `deny` was translated, reported, and
 * dropped.
 *
 * Measured the same day against Claude Code on byte-identical configuration: it refused a
 * `Read(./off-limits.txt)` deny rule; this ecosystem answered with the file's contents.
 *
 * The factory lives here rather than in the consumer because the SDK types it wraps
 * (`PermissionEngine`, `PermissionPlugin`) are the framework's to own — `createToolHooksPlugin` next
 * door sets the precedent: a consumer names a capability, never an SDK class.
 */
describe('createPermissionsPlugin', () => {
  it('test_it_builds_a_plugin_from_rules_a_settings_file_produced', () => {
    const { rules } = permissionRulesFromSettings({ deny: ['Bash(rm:*)'], allow: ['Read'] })

    expect(rules.length, 'the fixture must translate, or this proves nothing').toBeGreaterThan(0)
    expect(createPermissionsPlugin(rules, { onAsk: () => ({ behavior: 'allow' }) })).toBeDefined()
  })

  it('test_no_rules_means_no_plugin', () => {
    // A plugin built over an empty rule set is a gate that can only say yes. Returning `undefined`
    // lets the caller omit it entirely, which is the difference between "no policy" and "a policy
    // that permits everything" — and the second is what an operator would read a green row as.
    expect(createPermissionsPlugin([], { onAsk: () => ({ behavior: 'allow' }) })).toBeUndefined()
  })
})
