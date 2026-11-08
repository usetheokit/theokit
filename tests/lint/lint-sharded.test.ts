/**
 * The full-repository lint runs in bounded shards (B-431): one `eslint .` reached ~4.5 GiB
 * resident and was killed by earlyoom. Splitting must never drop a file.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs script, no declarations
import { planShards, MAX_FILES_PER_SHARD, LINTABLE } from '../../scripts/lint-sharded.mjs'

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
