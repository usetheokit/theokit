/**
 * The release guard checks the packages a release actually publishes — not every package that
 * exists (usetheokit/theokit#330).
 *
 * ## The failure this exists to catch
 *
 * The guard asked "is this version already on the registry?" of EVERY publishable package. In a
 * changesets monorepo only the packages a changeset names get bumped, so every untouched package
 * sits at the version it was last published under — which is the steady state after any successful
 * release, and which the guard reported as a collision. Measured on `workspace`: a release bumping
 * `theokit` and `create-theokit` was refused because `@theokit/agents`, `@theokit/http`,
 * `@theokit/presenter` and `@theokit/tauri` were unchanged and therefore already published.
 *
 * As written, the check could only pass if every package were bumped on every release — which is
 * precisely what changesets is designed not to do. It blocked correct releases and would have kept
 * blocking them.
 *
 * What it must NOT lose is the failure it was built for (M67): a version recomputed on a branch
 * that never got the back-merge, colliding with content already on the registry under that number.
 * That case still has a version DIFFERENT from the baseline, so it stays in the checked set.
 *
 * @internal
 */

import { describe, it, expect } from 'vitest'
import {
  releaseSet,
  // @ts-expect-error — plain .mjs release guard, no declarations by design
} from '../../scripts/verify-version-not-published.mjs'

const AGENTS = { dir: 'packages/agents', name: '@theokit/agents', version: '10.1.0' }
const THEO = { dir: 'packages/theo', name: 'theokit', version: '0.48.14' }

describe('release guard scope (theokit#330)', () => {
  it('skips a package whose version is unchanged from the released baseline', () => {
    const baseline = () => '10.1.0'
    expect(releaseSet([AGENTS], baseline)).toEqual([])
  })

  it('checks a package the release actually bumps', () => {
    const baseline = () => '0.48.13'
    expect(releaseSet([THEO], baseline)).toEqual([THEO])
  })

  it('checks a package that has no baseline at all — a new package is never assumed safe', () => {
    const baseline = () => undefined
    expect(releaseSet([THEO], baseline)).toEqual([THEO])
  })

  it('keeps the M67 case in scope: a recomputed bump differs from the baseline', () => {
    const recomputed = { ...AGENTS, version: '7.5.0' }
    const baseline = () => '7.4.0'
    expect(releaseSet([recomputed], baseline)).toEqual([recomputed])
  })

  it('separates the two in one pass', () => {
    const baseline = (name: string) => (name === 'theokit' ? '0.48.13' : '10.1.0')
    expect(releaseSet([AGENTS, THEO], baseline)).toEqual([THEO])
  })
})
