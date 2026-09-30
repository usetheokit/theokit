// Typed by `scripts/sync-template-pins.d.mts` — no suppression, so a future change to the
// declaration is caught here rather than in a consumer.
import { describe, expect, it } from 'vitest'

import { pinLinePattern } from '../../scripts/sync-template-pins.mjs'

/**
 * The escape level that made the sync skip every scoped package in silence.
 *
 * `sync-template-pins.mjs` built its rewrite pattern inline with
 * `name.replaceAll('/', '\\\\/')` — four backslashes in the source — producing the regex source
 * `("@theokit\\\/agents"\s*:\s*)"([^"]+)"`, which demands a LITERAL BACKSLASH before the slash.
 * Measured 2026-09-30 by running both patterns in node against `  "@theokit/agents": "^12.1.0",`:
 *
 *     rewrite (:228, four backslashes)  ->  false
 *     audit   (:164, two backslashes)   ->  true
 *     `theokit`, no slash               ->  true
 *
 * So an unscoped pin was rewritten and a scoped one never was. On disk when this was found:
 * `templates/default/package.json.tmpl` pinned `@theokit/agents@^12.1.0` while npm `latest` was
 * `15.0.2` — three majors — and every scaffolded app imports that package from
 * `src/server/agents/chat.ts`.
 *
 * The guard that exists for this could not fire either: `reportPrereleasePins` returns 1 on a pin
 * that excludes the published stable, and it runs only when `inPrereleaseMode()`. `.changeset/pre.json`
 * is absent, so in normal mode nothing audited and the rewrite that should have bumped could not match.
 *
 * ## Why one function rather than two corrected copies
 *
 * The two sites held the same knowledge — how a dependency line for one package name is matched — in
 * two spellings, and they diverged by one invisible character. Correcting the broken copy leaves the
 * pair free to diverge again. This is DRY about knowledge, which is the case DRY is actually for.
 */
describe('pinLinePattern', () => {
  it('matches a scoped name', () => {
    // THE case. `.test()` returned false here, which is the whole defect.
    const line = '  "@theokit/agents": "^12.1.0",'

    const match = pinLinePattern('@theokit/agents').exec(line)

    expect(match, 'a scoped pin line did not match, so the sync skips it in silence').not.toBeNull()
    expect(match?.[2]).toBe('^12.1.0')
  })

  it('matches an unscoped name', () => {
    // COUNTERPROOF: the fix must not be a widening that stops matching what already worked.
    const match = pinLinePattern('theokit').exec('  "theokit": "^0.74.0",')

    expect(match).not.toBeNull()
    expect(match?.[2]).toBe('^0.74.0')
  })

  it('carries no doubled escape in its source', () => {
    // The two patterns differed by a character no reader sees in a diff. Asserting the source is what
    // makes the difference visible, and a match assertion alone would pass on several wrong patterns.
    expect(pinLinePattern('@theokit/agents').source).not.toContain('\\\\')
  })

  it('does not match a different package whose name contains it', () => {
    // `theokit` is a prefix of `theokit-devtools`, and a pattern loose enough to match the longer
    // line would rewrite the wrong pin — a worse failure than not matching at all.
    expect(pinLinePattern('theokit').test('  "theokit-devtools": "^1.0.0",')).toBe(false)
  })

  it('captures the prefix so a replacement can keep it', () => {
    // The rewrite does `updated.replace(line, `$1"${wanted}"`)`, so group 1 must be everything up to
    // and including the colon and its spacing. Without it the replacement destroys the key.
    const match = pinLinePattern('@theokit/agents').exec('  "@theokit/agents":   "^12.1.0",')

    expect(match?.[1]).toBe('"@theokit/agents":   ')
  })
})
