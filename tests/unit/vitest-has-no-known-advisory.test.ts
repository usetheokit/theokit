import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * GHSA-82fw-gwwq-j7x9 (MEDIUM) is fixed in vitest 4.1.11 (B-428). Every importer of the workspace
 * has to resolve vitest and @vitest/* at or above that release.
 */
const FIXED_IN = [4, 1, 11]

const lock = readFileSync(resolve(import.meta.dirname, '../../pnpm-lock.yaml'), 'utf8')
const importersSection = lock.slice(lock.indexOf('\nimporters:'), lock.indexOf('\npackages:'))

function atOrAbove(version: string): boolean {
  const parts = version.split('.').map((part) => Number.parseInt(part, 10))
  for (let index = 0; index < FIXED_IN.length; index += 1) {
    const have = parts[index] ?? 0
    if (have !== FIXED_IN[index]) return have > (FIXED_IN[index] ?? 0)
  }
  return true
}

describe('the workspace vitest', () => {
  it('resolves vitest and @vitest/* at or above 4.1.11 in every importer', () => {
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
