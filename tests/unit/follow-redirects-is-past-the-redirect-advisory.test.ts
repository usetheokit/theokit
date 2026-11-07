import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Keeps the lockfile off follow-redirects releases below 1.16.2 (GHSA-mrwp-f3q8-3g9p, high), which
 * reached the production tree through `@microsoft/teams.apps > axios`. The root `pnpm.overrides`
 * entry moves it. Reads two local files, so it runs offline.
 */
const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const OVERRIDE_KEY = 'follow-redirects@<1.16.2'
const PATCHED = [1, 16, 2]

function atLeastPatched(v: number[]): boolean {
  for (let i = 0; i < 3; i++) if (v[i] !== PATCHED[i]) return (v[i] ?? 0) > PATCHED[i]
  return true
}

function lockfileVersions(lockfile: string): number[][] {
  return [...lockfile.matchAll(/^ {2}follow-redirects@(\d+)\.(\d+)\.(\d+)[(:]/gm)].map((m) => [
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
  ])
}

describe('follow-redirects past GHSA-mrwp-f3q8-3g9p', () => {
  it('the root manifest overrides every follow-redirects below 1.16.2', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      pnpm?: { overrides?: Record<string, string> }
    }
    const value = manifest.pnpm?.overrides?.[OVERRIDE_KEY] ?? ''
    const m = /^\^?(\d+)\.(\d+)\.(\d+)$/.exec(value)
    expect(m, `override value is ${value}`).not.toBeNull()
    expect(atLeastPatched([Number(m?.[1]), Number(m?.[2]), Number(m?.[3])])).toBe(true)
  })

  it('every follow-redirects the lockfile resolves is at or above 1.16.2', () => {
    const versions = lockfileVersions(readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf-8'))
    expect(versions.length).toBeGreaterThan(0)
    expect(versions.filter((v) => !atLeastPatched(v))).toEqual([])
  })

  it('the comparison ranks 1.16.2 and 1.17.0 as patched and 1.16.1 as not', () => {
    expect(atLeastPatched([1, 16, 2])).toBe(true)
    expect(atLeastPatched([1, 17, 0])).toBe(true)
    expect(atLeastPatched([1, 16, 1])).toBe(false)
    expect(atLeastPatched([1, 9, 9])).toBe(false)
    expect(atLeastPatched([2, 0, 0])).toBe(true)
  })
})
