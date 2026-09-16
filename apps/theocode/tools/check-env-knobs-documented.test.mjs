/**
 * Tests for the environment-knob discoverability gate.
 *
 * The sibling gate — check-config-documented.mjs, "every key an operator can set must be findable
 * in the README" — reads CONFIG_SCHEMA_KEYS and nothing else, so it reported "all 13 config keys are
 * documented" while `THEOCODE_DIAGNOSTICS` and `THEOKIT_SEARCH_API_URL` were readable from the
 * environment, changed real behaviour, and appeared in no document an operator consults.
 *
 * Two of these are anti-vacuity floors, for the reason the doc-reference guard states: a matcher
 * that finds everything and one that finds nothing both pass a single positive case.
 */
import { describe, expect, it } from 'vitest'

import { envNamesRead, undocumentedKnobs } from './check-env-knobs-documented.mjs'

describe('envNamesRead', () => {
  it('test_it_finds_both_property_and_index_reads', () => {
    expect(envNamesRead("process.env.FOO_BAR ?? env['BAZ_QUX']")).toEqual(['BAZ_QUX', 'FOO_BAR'])
  })

  it('test_it_ignores_lowercase_members_and_prose', () => {
    // Anti-vacuity: a matcher returning every identifier after a dot would pass the case above.
    // `env.cwd` is a field on an options object, not a variable name.
    expect(envNamesRead('env.cwd + "the ENVIRONMENT is not a read"')).toEqual([])
  })

  it('test_a_name_inside_a_comment_is_not_a_read', () => {
    // Measured on the real tree: `home-dir.ts` explains a decision with the placeholder
    // `env.X ?? default`, and the first version of this gate reported `X` as an undocumented knob.
    // A gate whose first real run is a false positive is a gate that gets switched off.
    expect(envNamesRead('// see env.PLACEHOLDER\n/* env.OTHER */\nenv.REAL_ONE')).toEqual([
      'REAL_ONE',
    ])
  })
})

describe('undocumentedKnobs', () => {
  const registry = "const A = 'REGISTERED_ONE'\n"
  const readme = 'the README mentions `REGISTERED_ONE` and `LOOSE_ONE`'

  it('test_a_name_read_in_production_and_absent_from_both_is_reported', () => {
    expect(undocumentedKnobs(['LOOSE_ONE'], registry, readme, new Map())).toEqual(['LOOSE_ONE'])
  })

  it('test_a_name_in_the_registry_and_the_readme_is_not_reported', () => {
    expect(
      undocumentedKnobs(['REGISTERED_ONE'], registry + "const B = 'REGISTERED_ONE'", readme, new Map()),
    ).toEqual([])
  })

  it('test_the_registry_alone_is_not_enough', () => {
    // The finding's exact shape: a knob can be registered and still be undiscoverable. `ENV_KNOBS`
    // is a source list; the README is what an operator reads.
    expect(undocumentedKnobs(['REGISTERED_ONE'], registry, 'no mention here', new Map())).toEqual([
      'REGISTERED_ONE',
    ])
  })

  it('test_an_exempt_name_is_skipped_and_its_reason_is_required', () => {
    // Anti-vacuity on the escape hatch: an exemption with an empty reason is not an exemption.
    // A silent opt-out is the defect, so one that says nothing is refused like the name it covers.
    const withReason = new Map([['LOOSE_ONE', 'set by the harness, not by an operator']])
    expect(undocumentedKnobs(['LOOSE_ONE'], registry, readme, withReason)).toEqual([])
    expect(undocumentedKnobs(['LOOSE_ONE'], registry, readme, new Map([['LOOSE_ONE', '']]))).toEqual([
      'LOOSE_ONE',
    ])
  })
})
