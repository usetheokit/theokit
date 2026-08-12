import { describe, expect, it } from 'vitest'

import { findPublishedCollisions } from '../../scripts/verify-version-not-published.mjs'

/**
 * B-M67-07 — the release gate that would have caught the M67 near-miss.
 *
 * ## What happened, and why nothing stopped it
 *
 * `pnpm version-packages` computed `@theokit/agents@7.5.0`. That version had been on npm since
 * 2026-08-10, with different content. The cause was a stale base: commit `7ef84c56` ("Version
 * Packages") landed on `main` and consumed two changesets, `workspace` never received the back-merge,
 * so those changeset files were still on disk and `changeset version` added them to the new one — and
 * recomputed the same `7.4.2 → 7.5.0` bump a second time.
 *
 * `changeset publish` would not have published a duplicate; npm refuses, and changesets skips a
 * version it finds already on the registry. That is exactly what makes the failure dangerous: the
 * release "succeeds", publishing nothing, while the local CHANGELOG and the git tag now claim a
 * version whose content is not what shipped under that number. The mismatch is silent and permanent.
 *
 * So the gate belongs BEFORE the publish — right after the versions are computed — and it must fail
 * loud. It answers one question: does the registry already have the version we just wrote?
 */

/** A `npm view <pkg>@<version> version` double: the set of versions the registry already has. */
function registryWith(published: Record<string, readonly string[]>) {
  return (name: string, version: string): boolean => (published[name] ?? []).includes(version)
}

describe('B-M67-07 — the version-collision gate', () => {
  it('test_a_fresh_version_is_not_a_collision', () => {
    const collisions = findPublishedCollisions(
      [{ name: '@theokit/agents', version: '7.6.0' }],
      registryWith({ '@theokit/agents': ['7.4.2', '7.5.0'] }),
    )
    expect(collisions).toEqual([])
  })

  it('test_the_M67_near_miss_is_reported', () => {
    // The literal case: the base was stale, `changeset version` recomputed a bump that had already
    // shipped, and no gate in the repo noticed.
    const collisions = findPublishedCollisions(
      [{ name: '@theokit/agents', version: '7.5.0' }],
      registryWith({ '@theokit/agents': ['7.4.2', '7.5.0'] }),
    )
    expect(collisions).toEqual([{ name: '@theokit/agents', version: '7.5.0' }])
  })

  it('test_every_colliding_package_is_reported_not_just_the_first', () => {
    // A release bumps several packages at once. Reporting only the first would send the operator
    // through the same diagnosis N times.
    const collisions = findPublishedCollisions(
      [
        { name: '@theokit/agents', version: '7.5.0' },
        { name: 'theokit', version: '0.47.0' },
        { name: '@theokit/presenter', version: '0.7.0' },
      ],
      registryWith({ '@theokit/agents': ['7.5.0'], '@theokit/presenter': ['0.7.0'] }),
    )
    expect(collisions).toEqual([
      { name: '@theokit/agents', version: '7.5.0' },
      { name: '@theokit/presenter', version: '0.7.0' },
    ])
  })

  it('test_private_packages_are_not_checked', () => {
    // A private package is never on the registry, so every lookup would "pass" for the wrong reason.
    // Excluding it keeps the gate's green meaningful.
    const collisions = findPublishedCollisions(
      [{ name: 'theokit-monorepo', version: '1.0.0', private: true }],
      () => {
        throw new Error('the registry must not be consulted for a private package')
      },
    )
    expect(collisions).toEqual([])
  })

  it('test_an_empty_release_is_not_an_error', () => {
    expect(findPublishedCollisions([], registryWith({}))).toEqual([])
  })
})
