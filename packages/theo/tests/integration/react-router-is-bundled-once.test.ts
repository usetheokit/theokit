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

describe('react-router reaches the client bundle once', () => {
  it('the built scaffold exists, or the count below would assert nothing', () => {
    expect(
      existsSync(BUNDLE_DIR),
      `no built scaffold at ${BUNDLE_DIR} — run \`npx tsx packages/theo/src/cli/index.ts build\` in my-test with ssr:true first. A missing bundle is not a passing test.`,
    ).toBe(true)
    expect(clientAssets(BUNDLE_DIR).length, 'no index-*.js emitted').toBeGreaterThan(0)
  })

  it('carries exactly one Location context', () => {
    const total = clientAssets(BUNDLE_DIR)
      .map((f) => countLiteral(readFileSync(f, 'utf8'), 'displayName="Location"'))
      .reduce((a, b) => a + b, 0)
    expect(total, 'each react-router module instance names its Location context exactly once').toBe(
      1,
    )
  })

  it('carries exactly one DataRouter context', () => {
    const total = clientAssets(BUNDLE_DIR)
      .map((f) => countLiteral(readFileSync(f, 'utf8'), 'displayName="DataRouter"'))
      .reduce((a, b) => a + b, 0)
    expect(
      total,
      'each react-router module instance names its DataRouter context exactly once',
    ).toBe(1)
  })
})
