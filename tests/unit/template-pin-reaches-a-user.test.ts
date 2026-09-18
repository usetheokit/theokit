import { describe, expect, it } from 'vitest'

import { bumpForTemplatePins } from '../../scripts/template-pin-bump.mjs'

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

  it('does not bump a prerelease line, where the next patch is not a patch', () => {
    // `3.1.0-rc.2` + patch is ambiguous — rc.3, or 3.1.0? Answering it here would be a guess
    // about a release shape this script does not drive, so it refuses and names the version.
    expect(() => bumpForTemplatePins(['x: a -> b'], '3.1.0-rc.2')).toThrow(/prerelease/u)
  })
})
