import { describe, expect, it } from 'vitest'

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { bumpForTemplatePins } from '../../scripts/template-pin-bump.mjs'
import { recordTemplatePinBump } from '../../scripts/sync-template-pins.mjs'

/**
 * A template pin that changes without republishing the package that carries it never reaches anyone.
 *
 * ## The failure, measured end to end on 2026-09-18
 *
 * `theokit@0.67.0` published the HITL approvals scoping fix. Minutes later,
 * `npm create theokit@latest` produced an app declaring `"theokit": "^0.66.0"` and installing
 * `theokit@0.66.1` — inside the affected range of the advisory that release closed.
 *
 * Every step was individually correct. `sync-template-pins.mjs` wrote `^0.67.0` into
 * `templates/default/package.json.tmpl`, inside the `Version Packages` commit. `changeset publish`
 * then skipped the CLI, and said why in its own words: *"create-theokit is not being published
 * because version 3.0.0 is already published on npm"*. Nothing bumped it, because changesets sees
 * package dependencies and this pin lives in a TEMPLATE FILE it has no reason to read.
 *
 * So the corrected pin sat in the repository, reachable by nobody, until some unrelated change
 * happened to bump the CLI.
 *
 * ## Why a bump and not a louder failure
 *
 * Failing the release here would be the other honest option, and it is worse in this specific
 * shape: the release has already versioned and written CHANGELOGs by the time the pin is synced, so
 * a failure at that point leaves a half-cut release for a human to unpick. A patch bump is what
 * `changeset version` would have produced had it been able to see the edge, and the publish step
 * already keys on "local version is not on the registry" — the same mechanism, reached by the route
 * that works.
 *
 * ## The direction this does NOT cover, on purpose
 *
 * #438 is the opposite case — a pin naming a version the registry does not have YET, between the
 * bump and the publish. `unpublished-pin.test.ts` owns that one. Both are about the window between
 * those two events; they fail in opposite directions and neither implies the other.
 */
describe('bumpForTemplatePins', () => {
  it('asks for no bump when no pin changed', () => {
    expect(bumpForTemplatePins([], '3.0.0')).toBeNull()
  })

  it('bumps the patch of the package that ships the template when a pin changed', () => {
    expect(bumpForTemplatePins(['theokit: ^0.66.0 -> ^0.67.0'], '3.0.0')).toBe('3.0.1')
  })

  it('bumps from whatever the current version is, rather than from a remembered one', () => {
    expect(bumpForTemplatePins(['theokit: ^0.66.0 -> ^0.67.0'], '3.4.9')).toBe('3.4.10')
  })

  it('refuses a version it cannot parse rather than inventing one', () => {
    expect(() => bumpForTemplatePins(['x: a -> b'], 'not-a-version')).toThrow(/not-a-version/u)
  })

  it('stands down when changesets already bumped the package in this cycle', () => {
    // B-232, measured 2026-09-21 on the `Version Packages` commit a579fa436 that blocked PR #851.
    // `create-theokit` had a changeset of its own, so `changeset version` bumped 3.0.0 -> 3.0.1 AND
    // wrote the CHANGELOG entry for it. This helper then bumped 3.0.1 -> 3.0.2 and wrote nothing, so
    // the published version had no entry at all and `tests/smoke/changeset-config.test.ts:89`
    // refused the release: "expected '# create-theo\n\n## 3.0.1…' to contain '3.0.2'".
    //
    // The docblock above rests on a premise — "changesets sees package dependencies and this pin
    // lives in a TEMPLATE FILE it has no reason to read" — which is true of the PIN and false of the
    // PACKAGE whenever somebody also writes a changeset for it. Then the edge is not invisible, and
    // the bump this module exists to supply is a second one.
    expect(bumpForTemplatePins(['theokit: ^0.67.0 -> ^0.68.0'], '3.0.1', true)).toBeNull()
  })

  it('still bumps when changesets did not touch the package, which is why it exists', () => {
    // The case the module was written for, asserted beside the one above so neither can be
    // "fixed" by disabling the other.
    expect(bumpForTemplatePins(['theokit: ^0.67.0 -> ^0.68.0'], '3.0.0', false)).toBe('3.0.1')
  })

  it('does not bump a prerelease line, where the next patch is not a patch', () => {
    // `3.1.0-rc.2` + patch is ambiguous — rc.3, or 3.1.0? Answering it here would be a guess
    // about a release shape this script does not drive, so it refuses and names the version.
    expect(() => bumpForTemplatePins(['x: a -> b'], '3.1.0-rc.2')).toThrow(/prerelease/u)
  })
})

/**
 * B-232, the half that was missing. `bumpForTemplatePins` stops the DOUBLE bump; these cover the
 * bump this script legitimately performs, which reached the registry twice with no entry naming it.
 */
describe('recordTemplatePinBump', () => {
  const scratch = (): string => mkdtempSync(join(tmpdir(), 'theo-pin-changelog-'))

  it('test_the_bumped_version_gets_an_entry_naming_the_pins', () => {
    const dir = scratch()
    const file = join(dir, 'CHANGELOG.md')
    writeFileSync(file, '# create-theo\n\n## 3.0.1\n\n### Patch Changes\n\n- an older entry\n')

    expect(recordTemplatePinBump(file, '3.0.2', ['theokit: 0.68.0 -> 0.69.0'])).toBe(true)

    const text = readFileSync(file, 'utf8')
    expect(text, 'the new version has no heading').toContain('## 3.0.2')
    expect(text, 'the pin that caused the bump is not named').toContain('theokit: 0.68.0 -> 0.69.0')
    expect(text.indexOf('## 3.0.2'), 'the new entry did not land above the older one').toBeLessThan(
      text.indexOf('## 3.0.1'),
    )
    expect(text.startsWith('# create-theo'), 'the title was displaced').toBe(true)
  })

  it('test_a_second_run_does_not_stack_a_duplicate_entry', () => {
    const dir = scratch()
    const file = join(dir, 'CHANGELOG.md')
    writeFileSync(file, '# create-theo\n\n## 3.0.1\n')

    expect(recordTemplatePinBump(file, '3.0.2', ['theokit: a -> b'])).toBe(true)
    expect(recordTemplatePinBump(file, '3.0.2', ['theokit: a -> b'])).toBe(false)

    const headings = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trimEnd() === '## 3.0.2')
    expect(headings, 'the version is documented twice').toHaveLength(1)
  })

  it('test_an_absent_changelog_gets_the_entry_and_no_invented_title', () => {
    const file = join(scratch(), 'CHANGELOG.md')

    expect(recordTemplatePinBump(file, '1.0.1', ['theokit: a -> b'])).toBe(true)

    const text = readFileSync(file, 'utf8')
    expect(text.trimStart().startsWith('## 1.0.1'), 'a title was invented').toBe(true)
  })
})
