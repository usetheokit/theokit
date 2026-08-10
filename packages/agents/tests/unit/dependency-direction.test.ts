/**
 * M79 T1.1 — dependency direction: an implementation is a `dependency`, not a `peer`.
 *
 * ## What was inverted
 *
 * `@theokit/agents` had **zero `dependencies`** and six `peerDependencies`, among them the three
 * `@theokit/sdk*`. Declaring something a peer means "the host provides it" — and the host, here, is
 * agent-builder, which holds an UNBREAKABLE rule to **never import `@theokit/sdk*`** (gate
 * `agents/gates/m63-boundary.test.ts`).
 *
 * The consequence was literal: the consumer's `package.json` declared, and npm installed at the top
 * level, exactly the three packages it is forbidden to use. A package the consumer cannot even import
 * is not "substitutable by the host" by definition.
 *
 * ## What remains a peer, and why
 *
 * `zod` has to be the **same instance** the consumer uses to create schemas — two copies of zod
 * produce validators that do not recognize each other. `ai` is genuinely swappable (it is the model
 * SDK). `@theokit/http` is only used by whoever serves HTTP. Those three are legitimate peers.
 *
 * The criterion is what the DoD itself states: peer remains for the **genuinely substitutable**.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

const deps = pkg.dependencies ?? {}
const peers = pkg.peerDependencies ?? {}

/** Implementation: the consumer cannot import it, therefore cannot provide it. */
const IMPLEMENTATION = [
  '@theokit/sdk',
  '@theokit/sdk-tools',
  '@theokit/sdk-pty',
  // The wire (`@theokit/presenter/wire`) has been this layer's implementation since the
  // `remove-ai-dependency` plan: the consumer does not choose which frame parser we use, so it cannot
  // provide it. Externalized in tsup so that ONE instance of the schema exists at runtime.
  '@theokit/presenter',
] as const
/**
 * Genuinely substitutable by the host.
 *
 * `ai` LEFT this list: it stopped being a peer because it stopped being a published dependency. The
 * wire is ours, and the package remains only as a devDependency — the differential test's oracle. A
 * consumer no longer needs to provide it, so requiring it to be a peer started asserting the opposite
 * of the contract.
 */
const REPLACEABLE = ['zod', '@theokit/http'] as const

describe('M79 T1.1 — dependency direction', () => {
  it.each(IMPLEMENTATION)('test_%s_is_a_dependency_and_not_a_peer', (name) => {
    expect(
      deps[name],
      `\`${name}\` is this layer's implementation: the consumer is FORBIDDEN from importing it by the ` +
        'UNBREAKABLE boundary, so it cannot provide it. Declaring it a peer forces its manifest to ' +
        'list exactly what it cannot use.',
    ).toBeDefined()
    expect(peers[name]).toBeUndefined()
  })

  it.each(REPLACEABLE)('test_COUNTERPROOF_%s_remains_a_peer', (name) => {
    // Without this, moving ALL SIX would pass the tests above and break the `zod` case: two copies
    // produce validators that do not recognize each other, and the consumer creates schemas with its own.
    expect(
      peers[name],
      `\`${name}\` is genuinely substitutable by the host — it must stay a peer`,
    ).toBeDefined()
    expect(deps[name]).toBeUndefined()
  })

  it('test_no_package_sits_in_BOTH_places', () => {
    // A package in both `dependencies` AND `peerDependencies` is a resolution ambiguity: npm satisfies
    // the peer with the dependency itself and the warning disappears, hiding which of the two
    // declarations governs.
    const inBoth = Object.keys(deps).filter((n) => peers[n] !== undefined)
    expect(
      inBoth,
      `Declared in both dependencies AND peerDependencies: ${inBoth.join(', ')}`,
    ).toEqual([])
  })

  it('test_the_layer_no_longer_has_ZERO_dependencies', () => {
    // The previous state — zero deps, everything a peer — was the inversion in pure form: the layer
    // owned NOTHING of what it needs to work.
    expect(Object.keys(deps).length).toBeGreaterThan(0)
  })
})
