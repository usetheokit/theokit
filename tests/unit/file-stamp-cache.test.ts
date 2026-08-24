/**
 * The shared per-file memo behind the route and agent scanners (usetheokit/theokit#417).
 *
 * `theokit dev` re-scans on every request, so a TypeScript parse per file per scan is per-request
 * latency. The correctness the cache has to earn is narrow and testable: recompute when the file
 * changed, and not otherwise.
 */
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createFileStampCache } from '../../packages/theo/src/server/scan/file-stamp-cache.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixture(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'theo-stamp-'))
  dirs.push(dir)
  const file = join(dir, 'route.ts')
  writeFileSync(file, content, 'utf8')
  return file
}

describe('createFileStampCache', () => {
  it('computes once for an unchanged file', () => {
    const file = fixture('export const GET = 1')
    const cache = createFileStampCache<number>()
    let calls = 0

    cache.get(file, () => ++calls)
    cache.get(file, () => ++calls)
    cache.get(file, () => ++calls)

    expect(calls).toBe(1)
  })

  it('recomputes after an edit, without anyone invalidating by hand', () => {
    const file = fixture('export const GET = 1')
    const cache = createFileStampCache<number>()
    let calls = 0

    cache.get(file, () => ++calls)
    writeFileSync(file, 'export const GET = 1\nexport const POST = 2', 'utf8')
    cache.get(file, () => ++calls)

    expect(calls).toBe(2)
  })

  it('recomputes when only the mtime moved, at the same size', () => {
    // Size alone would miss an in-place edit of equal length; mtime alone would miss a touch-free
    // rewrite. The key carries both because each covers the other's blind spot.
    const file = fixture('export const GET = 1')
    const cache = createFileStampCache<number>()
    let calls = 0

    cache.get(file, () => ++calls)
    const later = new Date(Date.now() + 5_000)
    utimesSync(file, later, later)
    cache.get(file, () => ++calls)

    expect(calls).toBe(2)
  })

  it('caches a falsy result instead of recomputing it forever', () => {
    // `false` is the answer `agent-scan` stores most often — a truthiness check would recompute it
    // on every request, which is the defect this file exists to remove wearing a subtler hat.
    const file = fixture('export const GET = 1')
    const cache = createFileStampCache<boolean>()
    let calls = 0

    cache.get(file, () => {
      calls++
      return false
    })
    const second = cache.get(file, () => {
      calls++
      return false
    })

    expect(calls).toBe(1)
    expect(second).toBe(false)
  })

  it('clear() drops everything, so a fixture directory cannot outlive its test', () => {
    const file = fixture('export const GET = 1')
    const cache = createFileStampCache<number>()
    let calls = 0

    cache.get(file, () => ++calls)
    cache.clear()
    cache.get(file, () => ++calls)

    expect(calls).toBe(2)
  })
})
