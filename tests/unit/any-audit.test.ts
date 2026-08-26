import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const srcDir = path.resolve(import.meta.dirname, '../../packages/theo/src')

/**
 * The patterns, named so the suite below can exercise them against known strings instead of
 * only against the tree. A detector that is never fed a positive is a detector nobody has
 * seen detect: it reports green over an empty directory, a broken walk or a pattern that
 * matches nothing, and all three read identically from here.
 */
const PATTERNS = {
  annotation: ': any\\b',
  assertion: '\\bas any\\b',
  tsIgnore: '@ts-ignore',
  tsExpectError: '@ts-expect-error',
} as const

/**
 * Count matching lines under `srcDir`.
 *
 * This used to shell out to `grep ... | wc -l`. The pipe forced a shell, the shell parsed an
 * absolute path built from wherever the repository sits, and dropping the shell only moved the
 * problem to `PATH` resolving the name `grep`. A walk needs neither, and an audit that reads the
 * tree in-process cannot be told a different story by the environment it runs in.
 */
function grepCount(pattern: string): number {
  const re = new RegExp(pattern)
  let count = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!full.endsWith('.ts')) continue
      for (const line of readFileSync(full, 'utf-8').split('\n')) {
        if (re.test(line)) count += 1
      }
    }
  }
  walk(srcDir)
  return count
}

describe('Any Audit — Zero any in production code', () => {
  it('should have zero ": any" type annotations', () => {
    const count = grepCount(PATTERNS.annotation)
    expect(count).toBe(0)
  })

  it('should have zero "as any" type assertions', () => {
    // `\b` on both sides, and it is load-bearing. The pattern used to be the bare string
    // `as any`, which is a substring of ordinary English: `as anything`, `as anywhere`,
    // `was anyone`. It fired on a comment reading "the prefix as anything other than a
    // literal" — no assertion in the tree at all, and the gate red for prose.
    //
    // A detector that cannot tell its subject from a sentence about its subject is not
    // measuring what its name says, and the cost is worse than a false alarm: the fix
    // people reach for is rewording the comment, which leaves the matcher broken for
    // whoever writes the next sentence containing those six letters. (#515)
    const count = grepCount(PATTERNS.assertion)
    expect(count).toBe(0)
  })

  it('should have zero @ts-ignore directives', () => {
    const count = grepCount(PATTERNS.tsIgnore)
    expect(count).toBe(0)
  })

  it('should have zero @ts-expect-error in production code', () => {
    const count = grepCount(PATTERNS.tsExpectError)
    expect(count).toBe(0)
  })
})

/**
 * The gate, gated.
 *
 * Written after `\bas any\b` replaced the bare string `as any`, which had matched the word
 * "anything" in a comment and failed the build over prose. The count assertions above cannot
 * catch that class of defect in either direction: a pattern that matches too much fails on a
 * clean tree, and one that matches too little passes on a dirty one, and neither says which.
 */
describe('Any Audit — the patterns themselves', () => {
  const matches = (pattern: string, line: string): boolean => new RegExp(pattern).test(line)

  it('test_the_assertion_pattern_catches_a_real_cast', () => {
    for (const line of [
      'const x = y as any',
      'const x = y as any;',
      'foo(y as any)',
      'y as any as Z',
    ]) {
      expect(matches(PATTERNS.assertion, line), line).toBe(true)
    }
  })

  it('test_the_assertion_pattern_ignores_the_english_words_it_used_to_fail_on', () => {
    // Every one of these failed the build under the old bare-substring pattern. The first is
    // verbatim from packages/theo/src/cli/commands/build/emit-controllers.ts.
    for (const line of [
      ' * time someone writes the prefix as anything other than a literal.',
      '// was anyone able to reproduce this?',
      '// parse it as anything the caller asked for',
      '// it does not behave as anywhere else does',
    ]) {
      expect(matches(PATTERNS.assertion, line), line).toBe(false)
    }
  })

  it('test_the_annotation_pattern_catches_a_real_annotation_including_at_end_of_line', () => {
    // The end-of-line case is why this is `\b` and not `[^a-zA-Z]`: the old character class
    // required a character AFTER the word, so a declaration ending the line went unseen.
    for (const line of ['function f(x: any) {}', 'let x: any', 'const y: any[] = []']) {
      expect(matches(PATTERNS.annotation, line), line).toBe(true)
    }
  })

  it('test_the_annotation_pattern_ignores_a_word_that_merely_starts_with_any', () => {
    for (const line of [
      '// returns: anything the handler produced',
      'type T = { kind: anySuchThing }',
    ]) {
      expect(matches(PATTERNS.annotation, line), line).toBe(false)
    }
  })
})
