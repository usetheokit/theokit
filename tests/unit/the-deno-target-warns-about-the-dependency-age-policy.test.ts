/**
 * Deno refuses an npm package published inside its minimum-dependency-age window — 24 hours
 * by default, a supply-chain protection it applies at resolution time. Measured 2026-09-30
 * against a freshly published `@theokit/agents@15.0.2`:
 *
 *     error: Could not find npm package '@theokit/agents' matching '^15.0.2'.
 *     A newer matching version was found, but it was not used because it was newer than the
 *     specified minimum dependency date of 2026-09-29 19:41:05 UTC.
 *
 * The constraint comes from the project's own `package.json`, which the upload carries, so a
 * consumer who scaffolds right after a TheoKit release cannot deploy to Deno for 24 hours —
 * and the error names the package rather than the policy, so nobody reads it as temporary.
 *
 * The adapter does NOT set `minimumDependencyAge`. Lowering it is a supply-chain decision and
 * it belongs to whoever owns the project, not to a code generator: a default of 0 shipped by
 * us would silently remove a protection from every consumer. What the adapter owes is that
 * the failure be legible, which is what this asserts.
 */
import { describe, expect, it } from 'vitest'

import { renderDenoEntry } from '../../packages/theo/src/adapters/deno-deploy.js'

describe('the emitted entry', () => {
  const entry = renderDenoEntry(3000)

  it('names the policy, so the resolution error reads as temporary rather than as a missing package', () => {
    expect(entry).toContain('minimum-dependency-age')
  })

  it('names the flag that overrides it, because the error message names a package instead', () => {
    expect(entry).toContain('--min-dep-age')
  })

  it("does not set the policy for the project, which is not a code generator's call", () => {
    expect(entry).not.toContain('minimumDependencyAge:')
  })
})

describe('the deploy command the entry prescribes', () => {
  const entry = renderDenoEntry(3000)

  /*
   * Isolated on the platform by changing one thing at a time in one directory:
   *
   *   entry + deno.json + src/ + client/ + theo.config.ts     exit 0, /api/health 200,
   *                                                           agent deltas "P" + "ONG"
   *   the same directory, plus package.json                   exit 1, revision failed
   *   the same directory, with --ignore package.json          exit 0, and serving again
   *
   * The manifest is what Deno resolves npm specifiers against, so its ranges bring the
   * minimum-dependency-age policy with them. The entry reaches the framework through
   * `npm:` specifiers that carry no range, and resolves them at latest — which is what
   * the working deploys did, and why excluding the manifest is a correction rather than
   * a workaround.
   */
  it('excludes the manifest, which is what carries the version ranges', () => {
    expect(entry).toContain('--ignore package.json')
  })

  it('still excludes node_modules, which the upload cannot carry', () => {
    expect(entry).toContain('--ignore node_modules')
  })
})
