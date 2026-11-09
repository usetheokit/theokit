import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Keeps this repository's lockfile off the dompurify releases that GHSA-cg2g-xh64-v4q7 (critical,
 * SAFE_FOR_TEMPLATES bypass) and GHSA-mrv2-3pqr-j5jr (high, IN_PLACE) cover. Both are patched in
 * 3.4.17.
 *
 * dompurify reaches the production tree only through `@theokit/ui > mermaid` (an optional peer the
 * lockfile may no longer resolve), and no workspace manifest declares it, so the root
 * `pnpm.overrides` entry `dompurify@<3.4.17` is what moves it.
 * CI's `pnpm audit --prod --audit-level=high` catches a regression too, but it needs the registry;
 * this test reads two local files and runs offline. The tuple compare follows `caretAccepts` in
 * `ui-peer-range.test.ts`, with no `semver` dependency. `OVERRIDE_KEY` and `PATCHED` move together
 * with the `pnpm.overrides` entry.
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
const OVERRIDE_KEY = 'dompurify@<3.4.17'
type Version = [number, number, number]

const PATCHED: Readonly<Version> = [3, 4, 17]

/** `X.Y.Z` or `^X.Y.Z` → `[X, Y, Z]`; any other shape → `undefined`. */
function versionParts(spec: string): Version | undefined {
  const match = /^\^?(\d+)\.(\d+)\.(\d+)$/.exec(spec.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

/** True for a 3.x version at or above the first release with both fixes. */
function isPatched3x(version: Version | undefined): boolean {
  if (version?.[0] !== PATCHED[0]) return false
  for (let i = 1; i < 3; i++) {
    if (version[i] !== PATCHED[i]) return version[i] > PATCHED[i]
  }
  return true
}

/**
 * Every resolved dompurify key in the lockfile, peer suffix included. Only keys with a numeric
 * version right after `@` count: once the override exists, pnpm also writes
 * `  dompurify@<3.4.17: ^3.4.17` into the lockfile's `overrides:` header at the same indent, and
 * that line is the override, not a resolution.
 */
function lockfileDompurifyVersions(lockfile: string): Version[] {
  const keys = lockfile.matchAll(/^ {2}dompurify@(\d+)\.(\d+)\.(\d+)[(:]/gm)
  return [...keys].map((m): Version => [Number(m[1]), Number(m[2]), Number(m[3])])
}

/** How many resolved mermaid keys the lockfile holds; the override header line is not one. */
function lockfileMermaidKeyCount(lockfile: string): number {
  return [...lockfile.matchAll(/^ {2}mermaid@\d+\.\d+\.\d+[(:]/gm)].length
}

describe('dompurify past the sanitizer bypass advisories', () => {
  it('the root manifest overrides every dompurify below the sanitizer bypass fixes', () => {
    const manifest = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      pnpm?: { overrides?: Record<string, string> }
    }
    const value = manifest.pnpm?.overrides?.[OVERRIDE_KEY]

    expect(value, `pnpm.overrides["${OVERRIDE_KEY}"] is ${String(value)}`).toBeDefined()
    expect(isPatched3x(versionParts(value ?? '')), `override value is ${String(value)}`).toBe(true)
  })

  it('every dompurify the lockfile resolves is past the sanitizer bypass advisories', () => {
    const lockfile = readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf-8')
    const versions = lockfileDompurifyVersions(lockfile)

    // dompurify comes in only through mermaid, an optional peer of `@theokit/ui` that pnpm stops
    // resolving once the lockfile is re-resolved. No dompurify key is a pass only when no mermaid is
    // resolved either; a mermaid key with no dompurify key means the scan stopped matching.
    if (versions.length === 0) {
      expect(lockfileMermaidKeyCount(lockfile), 'mermaid resolved but no dompurify key found').toBe(
        0,
      )
    }
    expect(versions.filter((v) => !isPatched3x(v)).map((v) => v.join('.'))).toEqual([])
  })

  it('the version comparison ranks 3.4.17 above 3.4.9 and 3.5.0 above 3.4.99', () => {
    expect(isPatched3x([3, 4, 17])).toBe(true)
    expect(isPatched3x([3, 4, 9])).toBe(false)
    expect(isPatched3x([3, 4, 16])).toBe(false)
    expect(isPatched3x([3, 5, 0])).toBe(true)
    expect(isPatched3x([3, 4, 99])).toBe(true)
    expect(isPatched3x([4, 0, 0])).toBe(false)
  })

  it('an unreadable override value yields no parsed version', () => {
    expect(versionParts('>=3.4.17')).toBeUndefined()
    expect(versionParts('3.x')).toBeUndefined()
    expect(versionParts('*')).toBeUndefined()
    expect(isPatched3x(versionParts('>=3.4.17'))).toBe(false)
  })

  it('the mermaid scan counts resolved keys and skips an override header line', () => {
    const sample = [
      'overrides:',
      '  mermaid@<11.16.1: ^11.16.1',
      'packages:',
      '  mermaid@11.15.0:',
    ].join('\n')

    expect(lockfileMermaidKeyCount(sample)).toBe(1)
    expect(lockfileMermaidKeyCount('packages:\n  katex@0.18.10:')).toBe(0)
  })

  it('the lockfile scan reads a key with a peer suffix and skips the override header line', () => {
    const sample = [
      'overrides:',
      '  dompurify@<3.4.17: ^3.4.17',
      'packages:',
      '  dompurify@3.4.17:',
      '  dompurify@3.4.18(@types/trusted-types@2.0.7):',
    ].join('\n')

    expect(lockfileDompurifyVersions(sample)).toEqual([
      [3, 4, 17],
      [3, 4, 18],
    ])
  })
})
