/**
 * A release the root record does not name is a release the gate will fail — days later, on
 * somebody else's pull request.
 *
 * Measured on 2026-09-04 (usetheokit/theokit#656): the `Version Packages` commit 9c518579a bumped
 * `create-theokit` to 2.0.0-next.1 and did not touch the root CHANGELOG, because `[Unreleased]`
 * had been drained by the PREVIOUS cut. `record-root-changelog.mjs` returned early — correctly by
 * its own contract — and `check-changelog-current.mjs` then failed for three hours until an
 * unrelated PR (#655) was the next CI run.
 *
 * The two scripts disagreed: one treats an empty `[Unreleased]` as nothing to do, the other treats
 * an unnamed release as a defect. The heading is what settles it — the gate matches on the HEADING
 * naming the version, never on the body.
 *
 * This does NOT weaken the sibling rule that the recorder must not invent an entry
 * (`root-changelog-is-recorded-by-the-release.test.ts`). A heading is a fact about what was cut and
 * when. Change prose is a claim about what changed, and stays the human's to write.
 */
import { describe, expect, it } from 'vitest'

import { composeRecord } from '../../scripts/record-root-changelog.mjs'

describe('the root record names every version that was cut (#656)', () => {
  it('writes a dated heading when versions were cut and nobody wrote prose', () => {
    const record = composeRecord({
      unreleasedBody: '\n\n',
      cut: ['create-theokit 2.0.0-next.1'],
      date: '2026-09-04',
    })

    expect(record, 'an unnamed release is what the gate fails on').not.toBeNull()
    expect(record?.heading).toBe('## [create-theokit 2.0.0-next.1] - 2026-09-04')
  })

  it('...and invents no change prose for it', () => {
    const record = composeRecord({
      unreleasedBody: '\n\n',
      cut: ['create-theokit 2.0.0-next.1'],
      date: '2026-09-04',
    })

    // The body may point at where the detail lives. It may not describe changes nobody wrote.
    expect(record?.body ?? '').not.toMatch(/### (Added|Changed|Fixed|Removed|Security)/)
  })

  it('still carries the human prose across when there is some', () => {
    const record = composeRecord({
      unreleasedBody: '\n\n### Added\n\n- a thing somebody wrote (#1)\n',
      cut: ['theokit 0.65.0'],
      date: '2026-09-05',
    })

    expect(record?.body).toContain('- a thing somebody wrote (#1)')
    expect(record?.body).toContain('### Added')
  })

  it('records nothing when no version was cut', () => {
    // A run that bumped nothing has nothing to name, and a heading naming no version is a section
    // the release-record gate can never match.
    expect(
      composeRecord({
        unreleasedBody: '\n\n### Added\n\n- orphan prose\n',
        cut: [],
        date: '2026-09-05',
      }),
    ).toBeNull()
  })
})

describe('the 2026-11-18 release is on the root record (#2194)', () => {
  it('names all five versions that were cut', async () => {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
    const heading = text.split('\n').find((l) => l.startsWith('## [@theokit/agents 16.10.0'))

    expect(heading).toBeDefined()
    for (const v of [
      '@theokit/agents 16.10.0',
      'create-theokit 3.1.4',
      '@theokit/http 2.6.0',
      '@theokit/presenter 0.15.0',
      'theokit 0.83.0',
    ]) {
      expect(heading).toContain(v)
    }
  })
})

describe('the 2026-11-19 release is on the root record (#2273)', () => {
  it('names both versions that were cut', async () => {
    const { readFileSync } = await import('node:fs')
    const text = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8')
    const heading = text.split('\n').find((l) => l.startsWith('## [@theokit/agents 16.11.0'))

    expect(heading).toBeDefined()
    expect(heading).toContain('create-theokit 3.1.5')
    expect(heading).toContain('2026-11-19')
  })
})
