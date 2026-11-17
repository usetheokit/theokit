import { describe, expect, it } from 'vitest'
import { pairIntraLines, segmentWords } from '../../src/diff/index.js'
import type { DiffLine } from '../../src/diff/index.js'

describe('diff-word', () => {
  it('pairIntraLines pairs a deleted and an added line into word segments', () => {
    const del: DiffLine = { kind: 'del', text: 'const a = 1' }
    const add: DiffLine = { kind: 'add', text: 'const a = 2' }
    const map = pairIntraLines([del, add])
    expect(map.get(del)!.filter((s) => s.changed).map((s) => s.text)).toEqual(['1'])
    expect(map.get(add)!.filter((s) => s.changed).map((s) => s.text)).toEqual(['2'])
  })

  it('leaves unpaired lines and context out', () => {
    const del: DiffLine = { kind: 'del', text: 'x' }
    expect(pairIntraLines([del, { kind: 'context', text: 'y' }]).size).toBe(0)
  })

  it('segmentWords concatenates back to the original side', () => {
    expect(segmentWords('a b c', 'a x c', 'old').map((s) => s.text).join('')).toBe('a b c')
    expect(segmentWords('a b c', 'a x c', 'new').map((s) => s.text).join('')).toBe('a x c')
  })

  it('handles empty and very long lines', () => {
    expect(segmentWords('', '', 'old')).toEqual([])
    const long = 'w '.repeat(20000)
    expect(segmentWords(long, long + 'z', 'new').length).toBeGreaterThan(0)
  })
})
