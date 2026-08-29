/**
 * The root CHANGELOG must be written by the release, not by whoever remembers.
 *
 * `check-changelog-current.mjs` states the situation exactly: "`changeset version` never touches
 * this file — only a person does." That is a description of the defect, not of a design. The record
 * has fallen behind the registry four times:
 *
 *   59720883b  "three releases reached npm without reaching this file"
 *   c5b69972d  "two releases had reached the registry without reaching this file"
 *   21b706800  "two releases reached the registry without reaching this file"
 *   theokit@0.60.0 — caught by the gate on the promotion PR that followed the cut
 *
 * The fourth is why a rule was never going to be enough. It WAS recorded deliberately, ahead of the
 * tag, in a commit on `changeset-release/main`. Merging an unrelated PR into `main` then re-ran
 * `release.yml`, which regenerates that branch with `git push --force-with-lease`, and the record
 * went with it. Doing the right thing by hand did not survive the machine that owns the branch.
 *
 * So the write belongs inside `version-packages`, on the same commit the bot makes — and these two
 * assertions are what keep it there.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')

function versionPackagesScript(): string {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>
  }
  return manifest.scripts['version-packages'] ?? ''
}

describe('the release records the root CHANGELOG (#561 follow-up)', () => {
  it('`version-packages` runs the recorder', () => {
    expect(
      versionPackagesScript(),
      'without this the root record depends on somebody remembering, which has failed four times',
    ).toContain('record-root-changelog.mjs')
  })

  it('...after `changeset version`, which is what decides the versions it names', () => {
    // Order is the whole contract: the recorder reads the version bump out of the diff, so running
    // it first would name nothing and write a heading the release-record gate can never match.
    const script = versionPackagesScript()

    expect(script.indexOf('changeset version')).toBeLessThan(
      script.indexOf('record-root-changelog.mjs'),
    )
  })

  it('the recorder refuses to invent an entry', () => {
    // The one behaviour that must never drift: it MOVES prose a human wrote. A release with no
    // consumer-visible change is a real thing, and a generated line for it would be worse than the
    // silence — it would put words in the record that nobody chose.
    const source = readFileSync(join(ROOT, 'scripts', 'record-root-changelog.mjs'), 'utf8')

    expect(source).toContain('nothing to record')
    expect(source, 'the body must be carried across, never synthesised').toContain(
      'buckets.get(name).join',
    )
  })
})
