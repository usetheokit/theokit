import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Keeps this repository's lockfile off the zod releases GHSA-mrhx-c7xc-m3w5 covers (high, memory
 * exhaustion on oversized constrained collections). It is patched in 4.6.6.
 *
 * The root `pnpm.overrides` entry `zod` pins every zod in the workspace to one range, so a
 * manifest that asks for a newer zod still resolves to whatever that entry allows. The entry is
 * what moves it, and `apps/theoclaw`, a network-facing app, runs the copy it resolves. Same offline
 * shape as `dompurify-is-past-the-sanitizer-bypass-advisories.test.ts`.
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
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

/** Every resolved zod key in the lockfile (`  zod@X.Y.Z:` under `packages:` and `snapshots:`). */
function lockfileZodVersions(lockfile: string): Version[] {
  const keys = lockfile.matchAll(/^ {2}zod@(\d+)\.(\d+)\.(\d+)[(:]/gm)
  return [...keys].map((m): Version => [Number(m[1]), Number(m[2]), Number(m[3])])
}

describe('zod past the collection memory advisory', () => {
  it('the root manifest overrides zod to a range past the advisory', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      pnpm?: { overrides?: Record<string, string> }
    }
    const value = manifest.pnpm?.overrides?.zod

    expect(isPatched4x(versionParts(value ?? '')), `pnpm.overrides.zod is ${String(value)}`).toBe(
      true,
    )
  })

  it('every zod the lockfile resolves is past the advisory', () => {
    const versions = lockfileZodVersions(readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf-8'))

    expect(versions.length, 'no zod key found in pnpm-lock.yaml').toBeGreaterThan(0)
    expect(versions.filter((v) => !isPatched4x(v)).map((v) => v.join('.'))).toEqual([])
  })

  it('the version comparison ranks 4.6.6 above 4.4.3 and refuses another major', () => {
    expect(isPatched4x([4, 6, 6])).toBe(true)
    expect(isPatched4x([4, 6, 7])).toBe(true)
    expect(isPatched4x([4, 4, 3])).toBe(false)
    expect(isPatched4x([4, 6, 5])).toBe(false)
    expect(isPatched4x([3, 25, 0])).toBe(false)
    expect(isPatched4x(versionParts('^4.0.0'))).toBe(false)
  })
})
