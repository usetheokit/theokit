import { describe, expect, it } from 'vitest'

// @ts-expect-error plain .mjs script without declarations
import { checkReasons, findReasons } from '../../scripts/check-app-issue-reasons.mjs'

describe('findReasons', () => {
  it('finds a reason in a comment, with a sibling repository', () => {
    const text = [
      '// kept until #12',
      'const a = 1 // waiting on o/r#7 to ship',
      'x(); // fixed in #5',
    ].join('\n')
    const found = findReasons(text, 'a.ts')
    expect(found.map((f: { repo: string; issue: number }) => [f.repo, f.issue])).toEqual([
      ['usetheokit/theokit', 12],
      ['o/r', 7],
    ])
  })

  it('ignores code and history mentions', () => {
    expect(findReasons('const until = "until #3"\n// measured in #9', 'a.ts')).toEqual([])
  })
})

describe('checkReasons', () => {
  const reasons = [{ file: 'a.ts', line: 1, repo: 'o/r', issue: 1 }]
  it('passes an open issue', async () => {
    expect(await checkReasons(reasons, async () => 'open')).toEqual([])
  })
  it('fails a closed issue', async () => {
    expect(await checkReasons(reasons, async () => 'closed')).toEqual([
      expect.stringContaining('o/r#1 is closed'),
    ])
  })
  it('fails when the lookup fails', async () => {
    const out = await checkReasons(reasons, async () => {
      throw new Error('HTTP 403')
    })
    expect(out[0]).toContain('cannot verify')
  })
})
