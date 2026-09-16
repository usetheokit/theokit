/**
 * Durable memory is OFF unless someone asked for it, and it is a CONFIG key rather than a mood.
 *
 * It shipped the other way round: on for every trusted directory, with no key in `config.toml` and
 * only a volatile session switch (`memory-switch.ts`) that reset on the next launch. Codex ships the
 * same capability as a feature with `default_enabled: false` — `codex/codex-rs/features/src/lib.rs`,
 * `key: "memories"`, `Stage::Stable` — so this is not a difference of taste; the reference agent
 * these tests measure against does not turn it on either.
 *
 * Measured 2026-08-25, both halves of the cost:
 *
 *   WRITES  — a summary of every session lands in `<cwd>/.theokit/memory/sessions/`. Running the
 *             agent in someone's repository left files there nobody asked for; 332 KB had
 *             accumulated in this checkout, and a fresh benchmark directory grew one on its first
 *             turn.
 *   READS   — recall from earlier sessions enters later turns, so two identical runs of the same
 *             task can diverge because the second one saw the first. That is the one property a
 *             benchmark against another agent must not have.
 *   SCHEMA  — `memory_search` + `memory_get` add 1,462 chars to the tool set, re-sent on every
 *             round of every turn (17 tools in a directory with no store, 19 with one).
 *
 * These tests pin the DEFAULT and the fact that the key exists. Whether the composed agent honours
 * it is `chat.ts`'s business and is covered there.
 */
import { describe, expect, it } from 'vitest'

import { ConfigError, resolveConfig } from '../../src/config/config.js'

describe('memory is opt-in', () => {
  it('test_it_is_off_when_nobody_configured_it', () => {
    // The whole point. A tool that runs inside someone else's repository does not start writing to
    // it on the strength of a default.
    expect(resolveConfig({}).memory, 'memory defaults to on again').toBe(false)
  })

  it('test_a_user_who_wants_it_can_turn_it_on', () => {
    // Anti-vacuity: hard-coding `false` would satisfy the test above. The capability is real and
    // worth having — the correction is to the default, not to its existence.
    expect(resolveConfig({ user: { memory: true } }).memory).toBe(true)
  })

  it('test_the_project_layer_wins_over_the_user_layer_like_every_other_key', () => {
    // Memory is an ordinary last-wins setting, not a special case. A repository that declares it
    // wants memory gets it; the security floor covers `sandbox_mode`/`approval_policy` and this is
    // deliberately not in that family.
    expect(resolveConfig({ user: { memory: false }, project: { memory: true } }).memory).toBe(true)
    expect(resolveConfig({ user: { memory: true }, project: { memory: false } }).memory).toBe(false)
  })

  it('test_a_non_boolean_is_rejected_rather_than_coerced', () => {
    // `memory = "yes"` in TOML must fail loudly. Coercing it would silently enable writing to the
    // user's repository off a typo.
    //
    // The type and the field are asserted, not merely that something threw: a bare `.toThrow()`
    // passes on a `TypeError` from an unrelated null deref, so it would keep reporting green while
    // the typed-refusal contract this test exists to protect had rotted into a crash. Both values
    // were MEASURED — `ConfigError`, message `config.toml: Invalid input: expected boolean, received
    // string [memory]` — rather than inferred from what the code looks like it should raise.
    expect(() => resolveConfig({ user: { memory: 'yes' } })).toThrow(ConfigError)
    expect(() => resolveConfig({ user: { memory: 'yes' } })).toThrow(/\[memory\]/)
  })
})

/**
 * B-135 — `memory` is reachable from the environment, which it was not.
 *
 * The reachability detector asserts that every config key is settable by environment or explicitly
 * exempt, and `memory` was neither. It went unnoticed because the detector's input was a
 * hand-maintained copy of the schema that had drifted — so the gate reported green about a key it
 * never read. The list is derived now; this covers the key the derivation exposed.
 */
describe('memory is reachable from the environment', () => {
  it('test_the_environment_can_turn_it_on', () => {
    expect(resolveConfig({ env: { THEOCODE_MEMORY: 'true' } }).memory).toBe(true)
    expect(resolveConfig({ env: { THEOCODE_MEMORY: '1' } }).memory).toBe(true)
    expect(resolveConfig({ env: { THEOCODE_MEMORY: 'ON' } }).memory).toBe(true)
  })

  it('test_the_environment_can_turn_it_off_over_a_file_that_turned_it_on', () => {
    // The benchmark case the key exists for: a determinism-sensitive run overriding a checked-in
    // preference, without editing the operator's config.
    expect(
      resolveConfig({ user: { memory: true }, env: { THEOCODE_MEMORY: 'false' } }).memory,
    ).toBe(false)
  })

  it('test_an_unrecognised_value_fails_loud_instead_of_being_read_as_off', () => {
    // The dangerous direction. Silently treating a typo as `false` is how an operator believes a
    // capability is on while it is not — and for memory, that is a benchmark whose determinism the
    // operator thinks they disabled.
    expect(() => resolveConfig({ env: { THEOCODE_MEMORY: 'maybe' } })).toThrow(ConfigError)
  })
})
