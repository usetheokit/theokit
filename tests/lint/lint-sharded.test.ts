/**
 * The full-repository lint runs in bounded shards (B-431): one `eslint .` reached ~4.5 GiB
 * resident and was killed by earlyoom. Splitting must never drop a file.
 */
import { describe, expect, it } from 'vitest'
import {
  planShards,
  lintShard,
  MAX_FILES_PER_SHARD,
  LINTABLE,
} from '../../scripts/lint-sharded.mjs'

const make = (dir: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${dir}/f${i}.ts`)

describe('lint-sharded planShards', () => {
  const files = [
    ...make('packages/a/src', 700),
    ...make('tests/unit', 900),
    ...make('x', 3),
    'vitest.config.ts',
  ]
  const shards: string[][] = planShards(files)

  it('keeps every file exactly once', () => {
    expect(shards.flat().sort((a, b) => a.localeCompare(b))).toEqual(
      [...files].sort((a, b) => a.localeCompare(b)),
    )
  })

  it('bounds each shard', () => {
    for (const s of shards) expect(s.length).toBeLessThanOrEqual(MAX_FILES_PER_SHARD)
    expect(shards.length).toBeGreaterThan(1)
  })

  it('selects lintable extensions only', () => {
    expect(LINTABLE.test('a/b.tsx')).toBe(true)
    expect(LINTABLE.test('a/b.mjs')).toBe(true)
    expect(LINTABLE.test('a/b.md')).toBe(false)
  })
})

describe('lint-sharded lintShard', () => {
  const oom = { status: null, signal: 'SIGABRT' }
  const ok = { status: 0, signal: null }

  it('splits an aborted shard and lints every file', () => {
    const linted: string[] = []
    const files = ['a', 'b', 'c', 'd', 'e']
    const result = lintShard(files, (s: string[]) => {
      if (s.length > 2) return oom
      linted.push(...s)
      return ok
    })
    expect(result).toBe(true)
    expect(linted).toEqual(files)
  })

  it('keeps ordinary lint failures as failures without retrying', () => {
    let calls = 0
    const result = lintShard(['a', 'b'], () => {
      calls++
      return { status: 1, signal: null }
    })
    expect(result).toBe(false)
    expect(calls).toBe(1)
  })

  it('fails when a single file still aborts', () => {
    expect(lintShard(['a'], () => oom)).toBe(false)
  })
})
