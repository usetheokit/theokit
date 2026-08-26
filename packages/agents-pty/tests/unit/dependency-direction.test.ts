/**
 * The rule that came with the dependency (#460).
 *
 * `@theokit/sdk-pty` is this package's IMPLEMENTATION: an application takes its primitives from the
 * `@theokit/*` layer and is forbidden from importing `@theokit/sdk*` directly (M63), so it cannot
 * provide this one. Declaring it a peer would force a consumer's manifest to list exactly what it is
 * not allowed to use — which is why the optional-peer fix for #460 was tried and reverted.
 *
 * It asserts here because it stopped being true of `@theokit/agents`. Removing the line there
 * without adding it here would have deleted the guarantee rather than moved it, and the deletion
 * would have looked identical to the move in a diff.
 */
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as {
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

describe('dependency direction', () => {
  it('@theokit/sdk-pty is a dependency and not a peer', () => {
    expect(
      pkg.dependencies?.['@theokit/sdk-pty'],
      'this package exists to own that dependency; without it there is nothing here',
    ).toBeDefined()
    expect(
      pkg.peerDependencies?.['@theokit/sdk-pty'],
      'a peer would ask the consumer to declare a package the boundary forbids it from importing',
    ).toBeUndefined()
  })

  it('asks the consumer for nothing — a peerless install is the point', () => {
    // The whole reason this package exists is that the native step should be opt-in. A peer here
    // would put the choice back on every consumer's manifest.
    expect(Object.keys(pkg.peerDependencies ?? {})).toEqual([])
  })
})
