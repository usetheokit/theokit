import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { scanMiddlewares } from '../../packages/theo/src/server/scan/middleware-scan.js'

/**
 * usetheokit/theokit#351 — build-time scanners must order by code unit, never by
 * collation. `localeCompare` with no locale argument uses the default collator,
 * and Node derives that from `LC_ALL`/`LANG`: under `sv-SE` a U+00E4 sorts AFTER
 * `z`, under `en-US` it sorts before `a`. A scanner that orders that way emits a
 * different manifest per machine, and `middleware-scan` orders EXECUTION, so it
 * decides whether an auth middleware runs before or after what it protects.
 *
 * The fixture is what makes this test an instrument rather than a formality:
 * U+00E4 is the character whose position the collation tables disagree on. A
 * fixture of `a`/`b`/`c` passes under both orderings and would prove nothing —
 * which is why the defect survived #346, where the rule was first written down.
 *
 * The test needs no locale switch: under the default `en-US` collator the two
 * orderings already disagree on this fixture, so restoring `localeCompare` here
 * fails it.
 */

// The third name is written as an escape, not as a literal, and must stay that
// way: `tests/lint/no-ptbr.test.ts` sweeps the tree for diacritics to catch
// Portuguese leaking into an English-only codebase, and a literal `a-umlaut`
// trips it. The escape keeps the file bytes ASCII while the STRING still holds
// the character the collation tables disagree about — which is the whole point
// of the fixture.
const DISCRIMINATING = ['a-first.ts', 'z-last.ts', '\u00e4-collates-differently.ts']

let serverDir: string

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'theo-scan-ordering-'))
  serverDir = join(base, 'server')
  mkdirSync(join(serverDir, 'middleware'), { recursive: true })
})

function byCodeUnit(values: string[]): string[] {
  return [...values].sort((a, b) => {
    if (a < b) return -1
    if (a > b) return 1
    return 0
  })
}

describe('build-time scanner ordering is locale-independent (#351)', () => {
  it('test_middleware_execution_order_follows_code_unit_not_collation', () => {
    for (const name of DISCRIMINATING) {
      writeFileSync(join(serverDir, 'middleware', name), 'export default (c, next) => next()')
    }

    const scanned = scanMiddlewares(serverDir).map((path) => path.split('/').at(-1)!)

    expect(scanned).toEqual(byCodeUnit(DISCRIMINATING))
  })

  it('test_the_fixture_actually_discriminates_between_the_two_orderings', () => {
    // Guards the test above: if these ever agree, the assertion is vacuous and
    // the regression it exists to catch would pass silently.
    const collated = [...DISCRIMINATING].sort((a, b) => a.localeCompare(b))

    expect(collated).not.toEqual(byCodeUnit(DISCRIMINATING))
  })
})
