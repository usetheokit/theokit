import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * GHSA-82fw-gwwq-j7x9 (B-428) is fixed in 4.1.11. The related mocker advisories
 * GHSA-qxg6-89mg-rqv8 and GHSA-xp26-3454-mjgp require 4.1.12.
 */
const FIXED_IN = [4, 1, 12]

const lock = readFileSync(resolve(import.meta.dirname, '../../pnpm-lock.yaml'), 'utf8')
const importersSection = lock.slice(lock.indexOf('\nimporters:'), lock.indexOf('\npackages:'))
const workspaceLock = parse(lock) as {
  importers: Record<
    string,
    { devDependencies: Record<string, { specifier: string; version: string }> }
  >
  packages: Record<string, unknown>
}

function atOrAbove(version: string): boolean {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10))
  for (let index = 0; index < FIXED_IN.length; index += 1) {
    const have = parts[index] ?? 0
    if (have !== FIXED_IN[index]) return have > (FIXED_IN[index] ?? 0)
  }
  return true
}

describe('the workspace vitest', () => {
  it.each(['.', 'packages/agents', 'packages/agents-pty', 'apps/theocode'])(
    '%s declares and locks a patched Vitest release',
    (importer) => {
      const manifest = JSON.parse(
        readFileSync(resolve(import.meta.dirname, '../..', importer, 'package.json'), 'utf8'),
      ) as { devDependencies: { vitest: string } }
      const declared = manifest.devDependencies.vitest
      // Keep the minimum safe too: a regenerated lockfile must not admit 4.1.9 again.
      expect(declared).toMatch(/^\^\d+\.\d+\.\d+$/)
      expect(atOrAbove(declared.slice(1))).toBe(true)
      const locked = workspaceLock.importers[importer]!.devDependencies.vitest!
      expect(locked.specifier).toBe(declared)
      expect(atOrAbove(locked.version.split('(')[0]!)).toBe(true)
    },
  )

  it('has no vulnerable Vitest packages, including transitive dependencies', () => {
    const versions = Object.keys(workspaceLock.packages).flatMap((key) => {
      const match = /^(?:vitest|@vitest\/[\w-]+)@(\d+\.\d+\.\d+)$/.exec(key)
      return match ? [match[1]!] : []
    })
    expect(versions.length).toBeGreaterThan(0)
    expect(versions.filter((version) => !atOrAbove(version))).toEqual([])
  })

  it('resolves vitest and @vitest/* at or above 4.1.12 in every importer', () => {
    const resolved = [
      ...importersSection.matchAll(
        /^ {6}'?(vitest|@vitest\/[\w-]+)'?:\n {8}specifier: .*\n {8}version: (\d+\.\d+\.\d+)/gm,
      ),
    ].map((match) => ({ name: match[1], version: match[2] ?? '' }))

    expect(resolved.length).toBeGreaterThan(0)
    const below = resolved.filter((entry) => !atOrAbove(entry.version))
    expect(below).toEqual([])
  })
})
