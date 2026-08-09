/**
 * M96 U2 (Phase 2) — `SubagentDefinition` published alongside the loader.
 *
 * ## The defect
 *
 * `packages/agents/src/index.ts` already re-exports `discoverSubagents` from the SDK, but not the
 * TYPE that function returns. The natural name — `AgentDefinition` — is **taken** in the same index:
 * in `bridge/index.ts` it is the builder's BRANDED type (`[AGENT_BRAND]: true`). A consumer writing
 * `import type { AgentDefinition } from '@theokit/agents'` to name `discoverSubagents`'s return would
 * silently receive the wrong type — and the only remaining way out was to redeclare the shape by
 * hand, which is exactly the duplication M81 existed to delete.
 *
 * The alias resolves the collision without touching the occupied name, which is literally the pair
 * the peer publishes (`gemini-cli/packages/core/src/index.ts:191-192`: the loader and the type, side
 * by side).
 *
 * ## Why the FLOOR test compares a string, and not `satisfies` (ADR D11)
 *
 * The previous version of this oracle asserted MEMBERSHIP (*"the range includes the version"*), and
 * was vacuous by measurement: `semver.satisfies('4.36.0', '^4.35.0') === true`. It would pass with
 * the specifier untouched at `^4.35.0` — the version that does **not** have `settingSources`. A gate
 * that cannot fail is not a gate; it is an assertion.
 *
 * The comparison is a string one because `require.resolve('semver')` FAILS at this monorepo's root
 * (measured), and the floor of a caret range is the literal after the `^` — adding a dependency to
 * read a prefix is `parsimony-ladder.md` inside out.
 *
 * ## Why there are TWO oracles for the same dependency
 *
 * The manifest one proves what is DECLARED; the behavioural one proves what is INSTALLED. A correct
 * manifest over a stale tree is a false green, and only the second closes it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { AgentBuilder, discoverSubagents } from '../../src/index.js'
import type { AgentDefinition, SubagentDefinition } from '../../src/index.js'

/** The SDK version published in Phase 1 — the first one with `settingSources` (D11). */
const PHASE_1_VERSION = '4.36.0'

/**
 * Compares plain `X.Y.Z` versions. Not a semver library, and does not need to be: both sides here
 * are release versions from this repo's own manifest, with no pre-release or build metadata.
 */
function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] => v.split('.').map(Number)
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

const PACKAGE_ROOT = join(import.meta.dirname, '..', '..')

const cwd = mkdtempSync(join(tmpdir(), 'm96-subagent-definition-'))
afterAll(() => rmSync(cwd, { recursive: true, force: true }))

const agentsDir = join(cwd, '.theokit', 'agents')
mkdirSync(agentsDir, { recursive: true })
writeFileSync(
  join(agentsDir, 'analyst.md'),
  '---\nname: analyst\ndescription: analyses the repo\n---\n\nYou analyse.\n',
)

describe('M96 U2 — SubagentDefinition alongside the loader', () => {
  it('test_SubagentDefinition_is_exported_from_the_public_index', async () => {
    // The oracle is the typed ASSIGNMENT: the repo's `tsc` covers `packages/*/tests/**/*.ts`, so an
    // annotation that does not match is a compile error, not a comment. The runtime assertion exists
    // so the file is not a `.d.ts` in disguise.
    const definitions: Record<string, SubagentDefinition> = await discoverSubagents(cwd)
    expect(Object.keys(definitions)).toEqual(['analyst'])
    expect(definitions.analyst?.description).toBe('analyses the repo')
  })

  it('test_the_branded_AgentDefinition_is_still_the_builders', () => {
    // The COUNTERPROOF for the collision. Without it, somebody "solves" the problem by re-exporting
    // the SDK type under the occupied name and silently breaks every consumer of the builder.
    const doBuilder = AgentBuilder.create()
      .model('claude-sonnet-4-6')
      .system('You analyse.')
      .build()
    const brandado: AgentDefinition = doBuilder
    expect(brandado).toBeDefined()

    // @ts-expect-error — a data object WITHOUT the brand is not the builder's `AgentDefinition`.
    const unbranded: AgentDefinition = { description: 'analyses', prompt: 'You analyse.' }
    expect(unbranded).toBeDefined()
  })

  it('test_the_re_exported_discoverSubagents_carries_the_new_parameter', () => {
    // Measured THROUGH the layer's index, not the SDK's: this assertion is what proves U3's forwarding
    // along the `SDK → Theokit → AgentBuilder` chain. `options?` is optional with no default, so it
    // counts toward `Function.length` — 2 is the new signature's arity; 1 was the old one's.
    expect(discoverSubagents.length).toBe(2)
  })

  it('test_the_FLOOR_of_the_sdk_range_is_the_version_that_has_settingSources', () => {
    const manifesto = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    const faixa = manifesto.dependencies['@theokit/sdk']
    expect(faixa).toBeDefined()
    // FLOOR, never membership (D11): `^4.35.0` "includes" 4.36.0 and still permits installing the
    // version without `settingSources`.
    //
    // Asserted as `>=`, not `==`. Equality read the floor as "exactly the version that introduced
    // settingSources", which is not what D11 says and made the assertion fail on every legitimate
    // raise: M107 review HIGH-2 moved the floor to 4.37.0 because 4.36.0 silently ignores the `cwd`
    // that `Agent.list` advertises, and this test went red for guarding the opposite of its purpose.
    // A floor BELOW the settingSources version is the defect; a floor above it is the mechanism.
    const floor = faixa!.replace(/^[\^~]/, '')
    expect(
      compareVersions(floor, PHASE_1_VERSION),
      `the floor ${floor} is below ${PHASE_1_VERSION}, the first version with settingSources — a ` +
        'fresh install could resolve an SDK that lacks it',
    ).toBeGreaterThanOrEqual(0)
  })

  it('test_the_installed_sdk_actually_accepts_settingSources', async () => {
    // The oracle's second half: behavioural, independent of the manifest. An EMPTY list reads
    // NOTHING — the directory is never opened — so `{}` is only possible if the parameter exists and
    // is honoured. Against the previous SDK version, the option would be ignored and `{ analyst }`
    // would come back.
    const none = await discoverSubagents(cwd, { settingSources: [] })
    expect(none).toEqual({})

    // The inverted pair, which stops the test above from "proving" the read by never reading anything.
    const ofTheProject = await discoverSubagents(cwd, { settingSources: ['project'] })
    expect(Object.keys(ofTheProject)).toEqual(['analyst'])
  })

  it('test_NEGATIVE_the_alias_does_not_resolve_to_the_branded_type', () => {
    // The lens that stops the alias becoming a synonym of the occupied name: the builder's value has
    // no `description`/`prompt`, which a subagent definition REQUIRES.
    const doBuilder = AgentBuilder.create()
      .model('claude-sonnet-4-6')
      .system('You analyse.')
      .build()
    // @ts-expect-error — the builder's branded value is not a subagent definition.
    const comoSubagent: SubagentDefinition = doBuilder
    expect(comoSubagent).toBeDefined()
  })
})
