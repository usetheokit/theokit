import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Keeps this repository's lockfile off the zod releases that GHSA-mrhx-c7xc-m3w5 (high, memory
 * exhaustion) covers. The first patched release is 4.6.6.
 *
 * The root `pnpm.overrides` entry `zod` decides every zod resolution in this workspace, so its
 * floor is what moves the lockfile. CI's `pnpm audit --prod --audit-level=high` catches a
 * regression too, but it needs the registry; this test reads two local files and runs offline.
 * The tuple compare follows `dompurify-is-past-the-sanitizer-bypass-advisories.test.ts`, with no
 * `semver` dependency. `PATCHED` moves together with the override's floor.
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
const OVERRIDE_KEY = 'zod'
type Version = [number, number, number]

const PATCHED: Readonly<Version> = [4, 6, 6]

/** `X.Y.Z` or `^X.Y.Z` → `[X, Y, Z]`; any other shape → `undefined`. */
function versionParts(spec: string): Version | undefined {
  const match = /^\^?(\d+)\.(\d+)\.(\d+)$/.exec(spec.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

/** True for a 4.x version at or above the first release with the fix. */
function isPatched4x(version: Version | undefined): boolean {
  if (version?.[0] !== PATCHED[0]) return false
  for (let i = 1; i < 3; i++) {
    if (version[i] !== PATCHED[i]) return version[i] > PATCHED[i]
  }
  return true
}

/**
 * Every resolved zod key in the lockfile, peer suffix included. Only a key that starts the line
 * with `zod@` and a numeric version counts: the `overrides:` header line `  zod: ^4.6.6` has no
 * `@`, `zod-validation-error@…` has no `@` right after `zod`, and a `(zod@…)` inside another
 * package's peer suffix does not start the line.
 */
function lockfileZodVersions(lockfile: string): Version[] {
  const keys = lockfile.matchAll(/^ {2}zod@(\d+)\.(\d+)\.(\d+)[(:]/gm)
  return [...keys].map((m): Version => [Number(m[1]), Number(m[2]), Number(m[3])])
}

describe('zod past the memory exhaustion advisory', () => {
  it('the root manifest overrides every zod to a floor past the memory exhaustion fix', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      pnpm?: { overrides?: Record<string, string> }
    }
    const value = manifest.pnpm?.overrides?.[OVERRIDE_KEY]

    expect(value, `pnpm.overrides["${OVERRIDE_KEY}"] is ${String(value)}`).toBeDefined()
    expect(isPatched4x(versionParts(value ?? '')), `override value is ${String(value)}`).toBe(true)
  })

  it('every zod the lockfile resolves is past the memory exhaustion advisory', () => {
    const versions = lockfileZodVersions(readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf-8'))

    expect(versions.length, 'no zod key found in pnpm-lock.yaml').toBeGreaterThan(0)
    expect(versions.filter((v) => !isPatched4x(v)).map((v) => v.join('.'))).toEqual([])
  })

  it('the version comparison ranks 4.6.6 above 4.6.5 and 4.10.0 above 4.6.99', () => {
    expect(isPatched4x([4, 6, 6])).toBe(true)
    expect(isPatched4x([4, 6, 5])).toBe(false)
    expect(isPatched4x([4, 4, 3])).toBe(false)
    expect(isPatched4x([4, 6, 99])).toBe(true)
    expect(isPatched4x([4, 10, 0])).toBe(true)
    expect(isPatched4x([5, 0, 0])).toBe(false)
    expect(isPatched4x([3, 25, 76])).toBe(false)
  })

  it('an unreadable override value yields no parsed version', () => {
    expect(versionParts('>=4.6.6')).toBeUndefined()
    expect(versionParts('4.x')).toBeUndefined()
    expect(versionParts('*')).toBeUndefined()
    expect(isPatched4x(versionParts('>=4.6.6'))).toBe(false)
  })

  it('the lockfile scan reads a key with a peer suffix and skips lines that are not a zod resolution', () => {
    const sample = [
      'overrides:',
      '  zod: ^4.6.6',
      'packages:',
      '  zod-validation-error@4.0.2:',
      '  zod@4.6.7:',
      '  zod@4.6.8(typescript@5.9.3):',
      "  '@ai-sdk/gateway@4.0.11(zod@4.4.3)':",
    ].join('\n')

    expect(lockfileZodVersions(sample)).toEqual([
      [4, 6, 7],
      [4, 6, 8],
    ])
  })
})
