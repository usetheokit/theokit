import { describe, expect, it } from 'vitest'

import { unpublishedPins } from '../../scripts/unpublished-pins.js'

/**
 * The release deadlock this predicate exists to break (#438).
 *
 * `changeset version` bumps the scaffold template's `theokit` pin to the version the Version
 * Packages PR is what publishes. Between that bump and the publish, the pin names a version the
 * registry does not have — and the integration test that installs a scaffolded app fails, while
 * being a REQUIRED check on `main`. Its own failure message says the right thing and asks for the
 * impossible: "publish the pending release and re-run". Publishing requires the merge that the
 * failing check refuses.
 *
 * The test's subject is pnpm 11's build-approval behaviour. A dependency that cannot be resolved is
 * not that subject, so the run is skipped rather than failed — but only for a pin that is genuinely
 * absent from the registry, which is what this function decides.
 */
describe('unpublishedPins', () => {
  const exists = (spec: string) => spec !== 'theokit@0.50.0' && spec !== '@theokit/agents@11.0.0'

  it('reports nothing when every first-party pin resolves', () => {
    const deps = { theokit: '^0.48.14', react: '^19.0.0' }
    expect(unpublishedPins(deps, exists)).toEqual([])
  })

  it('names the pin the registry does not have', () => {
    expect(unpublishedPins({ theokit: '^0.50.0' }, exists)).toEqual(['theokit@0.50.0'])
  })

  it('reports every missing first-party pin, not just the first', () => {
    const deps = { theokit: '^0.50.0', '@theokit/agents': '^11.0.0' }
    expect(unpublishedPins(deps, exists)).toEqual(['theokit@0.50.0', '@theokit/agents@11.0.0'])
  })

  it('ignores third-party packages — their absence is a different problem', () => {
    expect(unpublishedPins({ react: '^99.0.0' }, () => false)).toEqual([])
  })

  it('ignores a range it cannot pin to one version', () => {
    // `>=1 <2` or `workspace:*` name no single version to probe, so this function has nothing to
    // say about them. Reporting them would turn a range it does not understand into a skip.
    expect(unpublishedPins({ theokit: 'workspace:*' }, () => false)).toEqual([])
    expect(unpublishedPins({ theokit: '>=0.48 <0.51' }, () => false)).toEqual([])
  })

  it('has nothing to say about an app with no dependencies', () => {
    expect(unpublishedPins(undefined, () => false)).toEqual([])
  })
})
