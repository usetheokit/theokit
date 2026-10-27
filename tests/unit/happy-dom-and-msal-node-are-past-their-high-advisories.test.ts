import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Keeps this repository's lockfile off two release lines that keep CI's production audit
 * (`pnpm audit --prod --audit-level=high`) red:
 *
 * - happy-dom `>=17.0.0 <=21.0.3`, GHSA-834v-8h66-3h79 (high, host code execution through an
 *   unsanitized import alias). First patched release: 21.0.4. It reaches the production tree as
 *   vitest's optional peer under `@theokit/sdk-tools`.
 * - @azure/msal-node `>=5.0.0-beta.0 <7.1.0`, GHSA-xcx6-jx8p-x3h5 (high, the authorization code
 *   flow may disclose parameters to an attacker-controlled endpoint). First patched release:
 *   7.1.0. It reaches the production tree through `theoclaw > @microsoft/teams.apps`.
 *
 * No workspace manifest declares either, so a root `pnpm.overrides` entry is what moves each one.
 * The audit catches a regression too, but it needs the registry; this test reads two local files
 * and runs offline. The tuple compare follows the zod and dompurify advisory tests, with no
 * `semver` dependency. Each row's `overrideKey` and `patched` move together with its override.
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
type Version = [number, number, number]

interface AdvisoryFloor {
  readonly packageName: string
  readonly advisory: string
  readonly overrideKey: string
  readonly patched: Readonly<Version>
}

const FLOORS: readonly AdvisoryFloor[] = [
  {
    packageName: 'happy-dom',
    advisory: 'GHSA-834v-8h66-3h79',
    overrideKey: 'happy-dom@<21.0.4',
    patched: [21, 0, 4],
  },
  {
    packageName: '@azure/msal-node',
    advisory: 'GHSA-xcx6-jx8p-x3h5',
    overrideKey: '@azure/msal-node@<7.1.0',
    patched: [7, 1, 0],
  },
]

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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

/**
 * Every resolved key of `packageName` in the lockfile, peer suffix included. A scoped key is
 * quoted (`  '@azure/msal-node@7.1.0':`), an unscoped one is not (`  happy-dom@21.0.4:`). Only a
 * key that starts the line counts: a `(happy-dom@…)` inside vitest's peer suffix, an importer's
 * `happy-dom: 21.0.4` dependency line and `@azure/msal-common@…` are not collected.
 */
function lockfileVersions(lockfile: string, packageName: string): Version[] {
  const name = escapeRegExp(packageName)
  const keys = lockfile.matchAll(
    new RegExp(String.raw`^ {2}'?${name}@(\d+)\.(\d+)\.(\d+)[(:']`, 'gm'),
  )
  return [...keys].map((m): Version => [Number(m[1]), Number(m[2]), Number(m[3])])
}

const manifest = (): { pnpm?: { overrides?: Record<string, string> } } =>
  JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
    pnpm?: { overrides?: Record<string, string> }
  }

describe.each(FLOORS)('$packageName past $advisory', ({ packageName, overrideKey, patched }) => {
  it('the root manifest overrides it to a floor past the advisory fix', () => {
    const value = manifest().pnpm?.overrides?.[overrideKey]

    expect(value, `pnpm.overrides["${overrideKey}"] is ${String(value)}`).toBeDefined()
    expect(
      isPatched(versionParts(value ?? ''), patched),
      `override value is ${String(value)}`,
    ).toBe(true)
  })

  // A tree that resolves no key of the package resolves no vulnerable version either: develop
  // carries no @azure/msal-node until the item that adds the Teams gateway lands there. The
  // override test above holds the floor in place for when it arrives.
  it('every resolved version is past the advisory', () => {
    const versions = lockfileVersions(
      readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf-8'),
      packageName,
    )

    expect(versions.filter((v) => !isPatched(v, patched)).map((v) => v.join('.'))).toEqual([])
  })
})

describe('advisory floor helpers', () => {
  it('the version comparison ranks the patched release above the one before it, within its major', () => {
    expect(isPatched([21, 0, 4], [21, 0, 4])).toBe(true)
    expect(isPatched([21, 0, 3], [21, 0, 4])).toBe(false)
    expect(isPatched([20, 9, 0], [21, 0, 4])).toBe(false)
    expect(isPatched([21, 10, 0], [21, 0, 4])).toBe(true)
    expect(isPatched([7, 1, 0], [7, 1, 0])).toBe(true)
    expect(isPatched([5, 6, 0], [7, 1, 0])).toBe(false)
    expect(isPatched([8, 0, 0], [7, 1, 0])).toBe(false)
  })

  it('an unreadable override value yields no parsed version', () => {
    expect(versionParts('>=21.0.4')).toBeUndefined()
    expect(versionParts('7.x')).toBeUndefined()
    expect(versionParts('*')).toBeUndefined()
    expect(isPatched(versionParts('>=7.1.0'), [7, 1, 0])).toBe(false)
  })

  it('the lockfile scan reads quoted and peer-suffixed keys and skips lines that are not a resolution', () => {
    const sample = [
      'importers:',
      '      happy-dom:',
      '        specifier: ^21.0.4',
      '        version: 21.0.4',
      'packages:',
      "  '@azure/msal-common@16.13.0':",
      "  '@azure/msal-node@7.1.0':",
      '  happy-dom@21.0.4:',
      '  happy-dom@21.0.5(typescript@5.9.3):',
      '  vitest@4.1.9(happy-dom@20.9.0):',
      "      '@azure/msal-node': 5.6.0",
    ].join('\n')

    expect(lockfileVersions(sample, 'happy-dom')).toEqual([
      [21, 0, 4],
      [21, 0, 5],
    ])
    expect(lockfileVersions(sample, '@azure/msal-node')).toEqual([[7, 1, 0]])
  })
})
