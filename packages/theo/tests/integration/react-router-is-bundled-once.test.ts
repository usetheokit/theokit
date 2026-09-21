/**
 * B-228 — react-router must reach the client bundle exactly once.
 *
 * Two module instances mean two React contexts. `RouterProvider` fills one; the route element's
 * components call `useLocation()` against the other and get `null`, so React Router's ErrorBoundary
 * replaces the whole tree with "Unexpected Application Error!". The server renders correctly —
 * one bundle there — which is why the defect was invisible to every HTTP-level check.
 *
 * ## Why this asserts the BUNDLE and not the config
 *
 * A test reading `config-hook.ts` for a `dedupe` key would pass while the bundle still carried two
 * instances. That is the difference between asserting a mechanism EXISTS and asserting it WORKED,
 * and this repository keeps finding the first shape where it wanted the second.
 *
 * ## Why `displayName`
 *
 * React Router assigns each context exactly one `displayName` per module instance, and a string
 * literal is the only marker that survives minification — identifier names do not. Measured on
 * 2026-09-20: react-router's own dist carries `displayName = "Location"` once; the built client
 * bundle carried `displayName="Location"` twice. The error message count was NOT usable — 6 in the
 * source chunk against 8 in the bundle, which is neither one instance nor two.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { clientAssets, countLiteral } from './react-router-bundle-probe.js'

const BUNDLE_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'my-test',
  '.theokit',
  'client',
  'assets',
)

/**
 * `my-test/` is GITIGNORED (`.gitignore:119`), so a clean checkout has no built scaffold and the
 * strong assertion below has nothing to read. Two cases, and the split is deliberate:
 *
 * - The CONFIG case runs everywhere, including CI, and is the WEAKER claim: it proves the key is
 *   declared, never that the bundle it produces carries one instance.
 * - The BUNDLE cases are the real property and run only where a scaffold has been built. They
 *   SKIP with the reason printed rather than passing vacuously, because a skipped case that reads
 *   as green is the failure this whole item is about, one genre over.
 *
 * Found reviewing this change's own first revision, where the bundle case asserted the directory
 * EXISTS — which would have failed the suite on every clean checkout.
 */
const HAS_SCAFFOLD = existsSync(BUNDLE_DIR) && clientAssets(BUNDLE_DIR).length > 0

describe('react-router reaches the client bundle once', () => {
  it('the framework declares the deduplication that produces the property', () => {
    const hook = readFileSync(
      join(import.meta.dirname, '..', '..', 'src', 'vite-plugin', 'config-hook.ts'),
      'utf8',
    )
    expect(hook, 'resolve.dedupe must name react-router').toContain("'react-router'")
    expect(hook, 'and react itself, which travels the same route').toContain("'react'")
  })

  it.skipIf(!HAS_SCAFFOLD)('carries exactly one Location context', () => {
    const total = clientAssets(BUNDLE_DIR)
      .map((f) => countLiteral(readFileSync(f, 'utf8'), 'displayName="Location"'))
      .reduce((a, b) => a + b, 0)
    expect(total, 'each react-router module instance names its Location context exactly once').toBe(
      1,
    )
  })

  it.skipIf(!HAS_SCAFFOLD)('carries exactly one DataRouter context', () => {
    const total = clientAssets(BUNDLE_DIR)
      .map((f) => countLiteral(readFileSync(f, 'utf8'), 'displayName="DataRouter"'))
      .reduce((a, b) => a + b, 0)
    expect(
      total,
      'each react-router module instance names its DataRouter context exactly once',
    ).toBe(1)
  })
})
