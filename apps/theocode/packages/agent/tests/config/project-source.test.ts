/**
 * B-008 — the `project` setting source enables more than subagent discovery.
 *
 * `chat.ts` gated `.settingSources(['project', 'user'])` on `posture.allows.subagents`. But that
 * source is not scoped to subagents: the SDK states twice in its own typings that enabling
 * `"project"` also turns on hooks declared in `.theokit/hooks.json`, and a hook is arbitrary command
 * execution on every tool call.
 *
 * TheoCode's own hooks pass a SECOND gate that the SDK path does not: a per-hook sha256 fingerprint
 * whose entire purpose is catching a hook whose command changed after it was approved
 * (`hook-trust.ts`). Gating the source on the wrong capability meant the fingerprint gate could be
 * sidestepped by declaring the hook where the SDK loads it instead.
 *
 * The trust catalog described the capability as covering `discoverSubagents` only, so the code and
 * its own documentation agreed with each other and both were wrong.
 */
import { describe, expect, it } from 'vitest'

import { projectSettingsPosture, projectSourceAllowed } from '../../src/config/project-source.js'
import type { TrustPosture } from '../../src/config/trust-posture.js'

const allows = (over: Partial<{ subagents: boolean; hooks: boolean }> = {}) => ({
  subagents: true,
  hooks: true,
  ...over,
})

describe('B-008 — the project source requires every capability it enables', () => {
  it('test_allowed_when_both_subagents_and_hooks_are_trusted', () => {
    // Anti-vacuity floor: refusing always would satisfy the assertions below.
    expect(projectSourceAllowed(allows())).toBe(true)
  })

  it('test_refused_when_hooks_are_not_trusted', () => {
    expect(
      projectSourceAllowed(allows({ hooks: false })),
      'the source was enabled on the strength of the subagents capability alone, while it also ' +
        'turns on SDK-loaded hooks — arbitrary command execution that skips the fingerprint gate',
    ).toBe(false)
  })

  it('test_refused_when_subagents_are_not_trusted', () => {
    expect(projectSourceAllowed(allows({ subagents: false }))).toBe(false)
  })

  it('test_refused_when_neither_is_trusted', () => {
    expect(projectSourceAllowed(allows({ subagents: false, hooks: false }))).toBe(false)
  })
})

/**
 * M86 — `@theokit/agents@8.0.0` stopped accepting `.settingSources(['project', 'user'])`.
 *
 * The framework now asks for evidence instead of a string: `project` takes a grant carrying the
 * `TrustPosture` that authorized it, so a refusal downstream can say WHERE the decision came from
 * (`env` / `store` / `default`) rather than only that it was refused.
 *
 * The two vocabularies do not line up by accident of naming — they are genuinely different. The
 * framework declares ONE capability, `projectSettings`; TheoCode declares several, and its gate for
 * this source is the CONJUNCTION of `subagents` and `hooks` (B-008 above). So this is a projection of
 * a decision that was already made, not a new one: `allows.projectSettings` is exactly
 * `projectSourceAllowed`, and `level`/`source` are carried through untouched.
 *
 * Carrying the provenance is the whole point. Rebuilding a posture with a fresh `source` would
 * type-check and would make every refusal downstream claim it came from a `default` — the field
 * exists precisely so an operator can tell an env override from a stored decision.
 */
// The title names the PACKAGE VERSION, not a milestone. `M86` is a milestone of the framework's
// roadmap; this repository has no ROADMAP.md, so citing it here would name something that resolves
// to nothing for a reader of TheoCode — the B-046 rule, which its own guard caught me breaking.
describe('@theokit/agents@8.0.0 — projecting the trust decision into the framework vocabulary', () => {
  // `TrustPosture['allows']` has one entry per DECLARED capability — the SDK builds it from the
  // catalog precisely so nothing is left ungated. A fixture with only the two keys this gate reads
  // is not a posture; it type-checks nowhere, and writing one taught me that the narrowing below is
  // the whole reason `projectSettingsPosture` exists.
  const posture = (over: Partial<{ subagents: boolean; hooks: boolean }> = {}): TrustPosture => ({
    level: 'trusted',
    source: 'store',
    allows: {
      agentsMd: true,
      customCommands: true,
      memory: true,
      mcp: true,
      projectConfig: true,
      skills: true,
      ...allows(over),
    },
  })

  it('test_the_projection_carries_the_ORIGINAL_source_not_a_rebuilt_one', () => {
    // The assertion that fails if somebody "simplifies" this into a freshly-resolved posture.
    const projected = projectSettingsPosture(posture())
    expect(projected.source).toBe('store')
    expect(projected.level).toBe('trusted')
  })

  it('test_projectSettings_is_granted_when_the_compound_gate_allows_it', () => {
    expect(projectSettingsPosture(posture()).allows.projectSettings).toBe(true)
  })

  it('test_projectSettings_is_WITHHELD_when_either_half_of_the_gate_refuses', () => {
    // Counter-proof against a projection that always grants: the compound gate must survive the
    // narrowing to a single capability, or B-008's fix is undone by the migration that followed it.
    expect(projectSettingsPosture(posture({ hooks: false })).allows.projectSettings).toBe(false)
    expect(projectSettingsPosture(posture({ subagents: false })).allows.projectSettings).toBe(false)
  })

  it('test_the_projection_declares_ONLY_the_capability_the_framework_knows', () => {
    // A leaked `subagents`/`hooks` key would be a posture claiming to gate capabilities the
    // framework never asked about — the shape of promise the SDK's own docs warn against.
    expect(Object.keys(projectSettingsPosture(posture()).allows)).toEqual(['projectSettings'])
  })
})
