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
  it('keeps reporting that the block does not take effect', () => {
    // The assertion that was INVERTED for one commit, and the inversion is the lesson.
    //
    // Removing `permissions` from `ignored` made `doctor` stop printing "not implemented here:
    // permissions" — while a `deny` an operator wrote still gated nothing, because `AgentBuilder`
    // exposes no seam that carries rules to the engine (measured against the published `.d.ts`:
    // `approval`, `approvals`, `guardrails`, `hooks`, `settingSources`, and `approval` is a HITL
    // prompt, not a policy evaluator).
    //
    // A diagnostic that had become false is strictly worse than the gap it described: the operator
    // goes from "I know this does nothing" to believing a protection is in force. So the key stays
    // reported until the seam exists.
    const read = foreign({ permissions: { deny: ['Read(./.env)'] } })

    expect(
      read.ignored,
      'doctor would stop warning while the block still gates nothing',
    ).toContain('permissions')
  })

  it('renders a deny entry into rules, ready for the seam that does not exist yet', () => {
    // The half that DOES work. Translating is not enforcing, and this assertion is deliberately
    // about the rendering alone — claiming more would be the false diagnostic above, in a test.
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
