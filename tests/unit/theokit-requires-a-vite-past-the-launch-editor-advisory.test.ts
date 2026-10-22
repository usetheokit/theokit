/**
 * GHSA-587h-7wmj-h5pm: vite `>=7.0.0 <=7.3.6` bundles a vulnerable launch-editor, and
 * `pnpm audit --prod --audit-level=high` fails CI on it. vite 7.3.7 is the first patched 7.x release.
 *
 * The audit itself cannot guard the fix: it needs the registry, and it reads only the lockfile, so it
 * would not notice the published floor sliding back while the lockfile stays patched. An app that
 * installs `theokit` resolves vite from the published range, which is why the floor is checked here
 * alongside the lockfile and the installed copy.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type VersionParts = [number, number, number]

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
const THEO_MANIFEST = resolve(ROOT, 'packages/theo/package.json')
const PATCHED: VersionParts = [7, 3, 7]

/** `X.Y.Z` or `^X.Y.Z` → `[X, Y, Z]`. Returns `undefined` for any other shape. */
function versionParts(version: string): VersionParts | undefined {
  const m = /^\^?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

/** Numeric tuple order, so 7.3.10 ranks above 7.3.7 (a string compare would not). */
function compareParts(a: VersionParts, b: VersionParts): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

/** On the 7.x line and at or past the first release with the advisory fixed; an unparsed version is not. */
function isPatched7x(parts: VersionParts | undefined): boolean {
  return parts?.[0] === 7 && compareParts(parts, PATCHED) >= 0
}

describe('version helpers', () => {
  it('orders versions numerically, so a two-digit patch counts as past 7.3.7', () => {
    expect(compareParts([7, 3, 10], [7, 3, 7])).toBeGreaterThan(0)
    expect(compareParts([7, 4, 0], [7, 3, 9])).toBeGreaterThan(0)
    expect(isPatched7x([7, 3, 10])).toBe(true)
    expect(isPatched7x([7, 3, 6])).toBe(false)
    expect(isPatched7x([8, 0, 0])).toBe(false)
  })

  it('reads no floor from a range that is not a caret range', () => {
    for (const range of ['>=7.3.7', '7.x', '*']) {
      expect(versionParts(range), `range "${range}"`).toBeUndefined()
    }
  })
})

describe('theokit requires a vite past the launch-editor advisory', () => {
  it('the vite floor theokit declares is the first release past the launch-editor advisory', () => {
    const manifest = JSON.parse(readFileSync(THEO_MANIFEST, 'utf-8')) as {
      dependencies?: Record<string, string>
    }
    const range = manifest.dependencies?.vite ?? '(absent)'
    // A bare pin is not a floor an app inherits, so only a caret range is read.
    const floor = range.startsWith('^') ? versionParts(range) : undefined
    expect(floor, `theokit declares vite "${range}", which is not a ^X.Y.Z range`).toBeDefined()
    expect(isPatched7x(floor), `theokit declares vite "${range}"`).toBe(true)
  })

  it('every vite the lockfile resolves is past the launch-editor advisory', () => {
    const lockfile = readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf-8')
    const versions = [...lockfile.matchAll(/^ {2}vite@(\d+\.\d+\.\d+)[(:]/gm)].map((m) => m[1])
    expect(versions.length, 'pnpm-lock.yaml has no vite entry').toBeGreaterThan(0)
    const unpatched = versions.filter((v) => !isPatched7x(versionParts(v)))
    expect(unpatched).toEqual([])
  })

  it('the vite theokit resolves at run time is past the launch-editor advisory', () => {
    const { version } = createRequire(THEO_MANIFEST)('vite/package.json') as { version: string }
    expect(isPatched7x(versionParts(version)), `resolved vite ${version}`).toBe(true)
  })
})
