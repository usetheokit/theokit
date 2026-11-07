import { describe, expect, it } from 'vitest'

import { lintInvocations, MAX_OLD_SPACE_MB, PARTITIONS } from '../../scripts/lint-partitions.mjs'

describe('lint partitions', () => {
  const runs = lintInvocations()

  it('lints every partition on its own and ends with the remainder of the repository', () => {
    expect(runs).toHaveLength(PARTITIONS.length + 1)
    const rest = runs.at(-1)!
    expect(rest[0]).toBe('.')
    for (const p of PARTITIONS.flat()) {
      expect(rest).toContain(`${p}/**`)
    }
  })

  it('never names a path twice as a target, so nothing is linted twice or dropped', () => {
    const targets = runs.flatMap((r) => r.filter((a, i) => !a.startsWith('--') && r[i - 1] !== '--ignore-pattern'))
    expect(new Set(targets).size).toBe(targets.length)
  })

  it('caps each process well under 2 GiB', () => {
    expect(MAX_OLD_SPACE_MB).toBeLessThan(2048)
  })
})
