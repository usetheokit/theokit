import { describe, expect, it } from 'vitest'

import { translateSettings } from '../../src/config/settings-json.js'
import { CONFIG_SCHEMA_KEYS } from '../../src/config/config-contract.js'

/**
 * `permissions` in a `.claude/settings.json` reached nothing, and `doctor` said so truthfully.
 *
 * Measured 2026-09-13 against the built CLI: the settings row read
 * `not implemented here: $schema, env, permissions, statusLine, ...` — and it was right.
 * `permissionRulesFromSettings` and `loadSettings` returned **0 files** across this product's source
 * against controls of 5 (`loadMcpJson`) and 90 (`@theokit/agents`). The framework shipped the
 * translation in `@theokit/agents@14.0.0`; nothing here called it, so an operator who wrote a `deny`
 * entry got no rule and no warning.
 *
 * ## Why this goes through the translator and not the SDK's raw block
 *
 * `@theokit/sdk` accepts `permissions: { allow, deny, ask }` directly, and its `parsePermissionRules`
 * **throws** a `ConfigurationError` on a line it cannot read — its own docblock says a silently
 * ignored policy line "is the belief-in-an-absent-protection the whole tier removes". That is the
 * right behaviour for OUR `.theokit/settings.json`, where a bad entry is our bug.
 *
 * `.claude/settings.json` is somebody else's file in somebody else's dialect. Crashing the agent
 * over a line written for another runtime would let their config file break ours. So the foreign
 * path translates: honoured where it can be, NAMED where it cannot — which is the only option that
 * is neither a crash nor a silent drop.
 */
const foreign = (raw: unknown) =>
  translateSettings(raw, {
    ownKeys: CONFIG_SCHEMA_KEYS,
    foreignRoot: true,
    hooksDelivery: 'inert' as const,
  })

describe('a permissions block is acted on, not ignored', () => {
  it('test_it_stops_reporting_the_block_as_inert_now_that_the_seam_exists', () => {
    // This assertion has been INVERTED TWICE, and both inversions are the lesson.
    //
    // It first asserted that `permissions` was absent from `ignored`. That was wrong: `doctor` stopped
    // printing "not implemented here: permissions" while a `deny` an operator wrote still gated
    // nothing, because `AgentBuilder` exposed no seam carrying rules to an engine. A diagnostic that
    // had become false was strictly worse than the gap it described — the operator went from "I know
    // this does nothing" to believing a protection was in force. So the key stayed reported, and the
    // comment said: UNTIL THE SEAM EXISTS.
    //
    // It exists (#736). `createPermissionsPlugin` builds the engine and the run carries it as a
    // `pre_tool_call` plugin, verified on the built binary: a project deny on a path refuses the read,
    // and an allowed path under `src/` still reads. So the line became false in the other direction,
    // and the same argument that kept it now removes it.
    //
    // What has NOT changed is `unsupportedPermissions` below — an entry this grammar cannot render is
    // still named, because the block taking effect says nothing about an entry that never became a
    // rule.
    const read = foreign({ permissions: { deny: ['Read(./.env)'] } })

    expect(
      read.ignored,
      'doctor would tell an operator their deny is inert while it is refusing reads',
    ).not.toContain('permissions')
  })

  it('renders a deny entry into rules, which is what the engine is built from', () => {
    // Translating is still not enforcing, and this assertion is still about the rendering alone.
    // What changed is what happens downstream: `permissionsPluginsFor` orders these rules
    // deny-first and hands them to an engine. Asserting enforcement HERE would test the
    // composition from the wrong end — `a-deny-wins-over-any-allow.test.ts` is where that lives.
    const read = foreign({ permissions: { deny: ['Read(./.env)'] } })

    expect(read.permissionRules.length).toBeGreaterThan(0)
  })

  it('names an entry it could not render, instead of dropping it', () => {
    // The half that makes the foreign path defensible. An entry this grammar cannot read must leave
    // a trace, or the operator believes a protection is in force.
    const read = foreign({ permissions: { deny: ['!!! not a rule !!!'] } })

    const said = [...read.permissionRules, ...read.unsupportedPermissions].length
    expect(said, 'the entry vanished — neither honoured nor reported').toBeGreaterThan(0)
  })

  it('says nothing when no block is declared', () => {
    // The control. Most files declare no permissions, and a translator that spoke up in every one of
    // them would be the noise that makes a report stop being read.
    const read = foreign({ model: 'x' })

    expect(read.permissionRules).toEqual([])
    expect(read.unsupportedPermissions).toEqual([])
  })

  it('does not crash on a block whose shape is not a block', () => {
    // A foreign file carries whatever its author typed. `permissions: "all"` is a typo in somebody
    // else's config, and it must not become an exception in ours.
    for (const bad of ['all', 42, null, [], { deny: 'Read(x)' }]) {
      expect(() => foreign({ permissions: bad })).not.toThrow()
    }
  })
})
