import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Keeps this repository's lockfile off follow-redirects `>=1.16.0 <=1.16.1`,
 * GHSA-mrwp-f3q8-3g9p (high), which keeps CI's production audit
 * (`pnpm audit --prod --audit-level=high`) and TheoClaw's own audit red. First patched release:
 * 1.16.2. It reaches the production tree through `theoclaw > @microsoft/teams.apps > axios` (and
 * through twilio), and no workspace manifest declares it, so a root `pnpm.overrides` entry is what
 * moves it.
 *
 * The audit catches a regression too, but it needs the registry and the live advisory database,
 * and it would not notice the override being dropped while the lockfile stays patched. This test
 * reads two local files and runs offline. The tuple compare follows the happy-dom/msal-node,
 * zod and dompurify advisory tests, with no `semver` dependency. `OVERRIDE_KEY` and `PATCHED` move
 * together with the override.
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
type Version = [number, number, number]

const ADVISORY = 'GHSA-mrwp-f3q8-3g9p'
const OVERRIDE_KEY = 'follow-redirects@<1.16.2'
const PATCHED: Readonly<Version> = [1, 16, 2]

/** `X.Y.Z` or `^X.Y.Z` → `[X, Y, Z]`; any other shape → `undefined`. */
function versionParts(spec: string): Version | undefined {
  const match = /^\^?(\d+)\.(\d+)\.(\d+)$/.exec(spec.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

/** True for a version in the patched release's major line, at or above it. */
function isPatched(version: Version | undefined, patched: Readonly<Version>): boolean {
  if (version?.[0] !== patched[0]) return false
  for (let i = 1; i < 3; i++) {
    if (version[i] !== patched[i]) return version[i] > patched[i]
  }
  return true
}

/**
 * Every resolved `follow-redirects@X.Y.Z` key in the lockfile, peer suffix included. Only a key
 * that starts the line counts: the `follow-redirects: 1.16.1` dependency line under axios is not a
 * resolution and is not collected.
 */
function lockfileVersions(lockfile: string): Version[] {
  const keys = lockfile.matchAll(/^ {2}follow-redirects@(\d+)\.(\d+)\.(\d+)[(:]/gm)
  return [...keys].map((m): Version => [Number(m[1]), Number(m[2]), Number(m[3])])
}

const manifest = (): { pnpm?: { overrides?: Record<string, string> } } =>
  JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
    pnpm?: { overrides?: Record<string, string> }
  }

describe(`follow-redirects past ${ADVISORY}`, () => {
  it(`the root manifest overrides follow-redirects to a floor past ${ADVISORY}`, () => {
    const value = manifest().pnpm?.overrides?.[OVERRIDE_KEY]

    expect(value, `pnpm.overrides["${OVERRIDE_KEY}"] is ${String(value)}`).toBeDefined()
    expect(
      isPatched(versionParts(value ?? ''), PATCHED),
      `override value is ${String(value)}`,
    ).toBe(true)
  })

  // follow-redirects is resolved on every branch today, so a lockfile with no key at all means
  // the scan stopped matching, not that the package left the tree.
  it(`every follow-redirects the lockfile resolves is past ${ADVISORY}`, () => {
    const versions = lockfileVersions(readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf-8'))

    expect(versions.length).toBeGreaterThan(0)
    expect(versions.filter((v) => !isPatched(v, PATCHED)).map((v) => v.join('.'))).toEqual([])
  })
})

describe('follow-redirects advisory floor helpers', () => {
  it('the version comparison ranks 1.16.2 at the floor, later 1.x above it and 1.16.1 below it', () => {
    expect(isPatched([1, 16, 2], PATCHED)).toBe(true)
    expect(isPatched([1, 16, 10], PATCHED)).toBe(true)
    expect(isPatched([1, 17, 0], PATCHED)).toBe(true)
    expect(isPatched([1, 16, 1], PATCHED)).toBe(false)
    expect(isPatched([1, 15, 9], PATCHED)).toBe(false)
  })

  it('an unreadable override value yields no parsed version, and 2.0.0 is outside the 1.x line', () => {
    expect(versionParts('>=1.16.2')).toBeUndefined()
    expect(versionParts('1.x')).toBeUndefined()
    expect(versionParts('*')).toBeUndefined()
    expect(isPatched(versionParts('>=1.16.2'), PATCHED)).toBe(false)
    expect(isPatched([2, 0, 0], PATCHED)).toBe(false)
  })

  it('the lockfile scan reads a peer-suffixed key and skips the dependency line under axios', () => {
    const sample = [
      'packages:',
      '  axios@1.20.0:',
      '  follow-redirects@1.16.2:',
      '  follow-redirects@1.16.3(debug@4.4.3):',
      'snapshots:',
      '  axios@1.20.0:',
      '    dependencies:',
      '      follow-redirects: 1.16.1',
    ].join('\n')

    expect(lockfileVersions(sample)).toEqual([
      [1, 16, 2],
      [1, 16, 3],
    ])
  })
})
