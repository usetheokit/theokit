import { describe, expect, it } from 'vitest'
import { DiffParseError, foldDiffLines, parseUnifiedDiff } from '../../src/diff/index.js'
import type { DiffLine } from '../../src/diff/index.js'

const TWO = `diff --git a/a.txt b/a.txt
index 111..222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,2 +1,2 @@
 keep
-old
+new
diff --git a/b.txt b/b.txt
index 333..444 100644
--- a/b.txt
+++ b/b.txt
@@ -40,2 +40,3 @@
 ctx
+added
 tail
`

describe('parseUnifiedDiff', () => {
  it('a two-file git diff parses into two DiffFile entries with names', () => {
    const files = parseUnifiedDiff(TWO)
    expect(files).toHaveLength(2)
    expect(files[0]).toMatchObject({
      oldName: 'a.txt',
      newName: 'a.txt',
      additions: 1,
      deletions: 1,
    })
    expect(files[1]!.newName).toBe('b.txt')
  })

  it('a hunk at line 40 numbers its lines 40 and 41', () => {
    const lines = parseUnifiedDiff(TWO)[1]!.lines
    expect(lines[0]).toMatchObject({ kind: 'context', oldLine: 40, newLine: 40 })
    expect(lines[1]).toMatchObject({ kind: 'add', newLine: 41 })
  })

  it('diff --git and index header lines never appear as context lines', () => {
    for (const f of parseUnifiedDiff(TWO))
      for (const l of f.lines) {
        expect(l.text).not.toMatch(/^diff --git/)
        expect(l.text).not.toMatch(/^index /)
      }
  })

  it('an empty patch returns []', () => {
    expect(parseUnifiedDiff('')).toEqual([])
    expect(parseUnifiedDiff('  \n')).toEqual([])
  })

  it('a non-empty patch that parses to nothing throws DiffParseError with code diff_unparseable', () => {
    let err: unknown
    try {
      parseUnifiedDiff('this is not a diff')
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(DiffParseError)
    expect(err).toBeInstanceOf(TypeError)
    expect((err as DiffParseError).code).toBe('diff_unparseable')
  })

  it('handles a very large patch', () => {
    const body = Array.from({ length: 5000 }, (_, i) => `+l${i}`).join('\n')
    const files = parseUnifiedDiff(`--- a/x\n+++ b/x\n@@ -0,0 +1,5000 @@\n${body}\n`)
    expect(files[0]!.additions).toBe(5000)
  })
})

describe('foldDiffLines', () => {
  it('foldDiffLines keeps contextLines around each change and folds the rest', () => {
    const lines: DiffLine[] = Array.from({ length: 10 }, (_, i) => ({
      kind: 'context',
      text: `c${i}`,
    }))
    lines[5] = { kind: 'add', text: 'x' }
    const rows = foldDiffLines(lines, 1)
    expect(rows.map((r) => (r.kind === 'fold' ? `fold${r.hidden}` : (r as DiffLine).text))).toEqual(
      ['fold4', 'c4', 'x', 'c6', 'fold3'],
    )
  })

  it('returns a single fold when nothing changed', () => {
    expect(foldDiffLines([{ kind: 'context', text: 'a' }], 2)).toEqual([
      { kind: 'fold', hidden: 1 },
    ])
  })
})
