/**
 * B-157 — a rules block that does not fit is cut BETWEEN rules, and says what it dropped.
 *
 * Two defects, one measurement. In this repository's own checkout, 8 of 34 rule files reach the
 * prompt and the block ends:
 *
 *   "## Modes\n\nEvery mode measures **our** system. They differ in what counts as a measure"
 *
 * Mid-word. The model receives a rule that stops in the middle of a sentence, has no way to know it
 * was cut, and reads it as the complete instruction. The previous behaviour was deliberate — its
 * docblock argued that "filling the budget beats stopping short of it" — but that trade priced the
 * cost as a tidy boundary. The real cost is a rule the model believes is whole and is not.
 *
 * And the 26 files that never arrive are invisible from inside the prompt. `/status` tells the
 * OPERATOR (#91); nothing told the model, so it reasons as though it holds the whole corpus.
 *
 * The order is fixed too. It was `readdir` order — so which rules survive was an accident of the
 * filesystem, and could differ between two machines with identical checkouts.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadRules } from '../../src/context/rules.js'
import { tempRoot } from '../helpers/temp-root.js'

const project = (blocks: readonly [string, string][]): string => {
  const cwd = tempRoot('rules-shape-')
  const dir = join(cwd, '.theokit', 'rules')
  mkdirSync(dir, { recursive: true })
  for (const [name, body] of blocks) writeFileSync(join(dir, name), body)
  return cwd
}

/** Twelve 8KB rules against a 64,000 ceiling: some fit, some cannot. */
const oversized = (): [string, string][] =>
  Array.from({ length: 12 }, (_, i) => [
    `r${String(i).padStart(2, '0')}.md`,
    `# rule ${String(i)}\n\n${'sentence. '.repeat(800)}END-OF-RULE-${String(i)}\n`,
  ])

describe('B-157 — truncation cuts between rules', () => {
  it('test_no_rule_is_cut_in_the_middle', () => {
    // The defect. Every block that made it in must be whole: a rule ending mid-word is one the
    // model completes for itself, and it has no signal that it is doing so.
    const { text } = loadRules(project(oversized()), () => {})
    const starts = (text.match(/# rule \d+/g) ?? []).length
    const ends = (text.match(/END-OF-RULE-\d+/g) ?? []).length

    expect(ends, 'a rule was cut mid-body — the model reads the fragment as the whole rule').toBe(starts)
  })

  it('test_the_model_is_told_what_was_dropped', () => {
    // `/status` tells the operator (#91). Nothing told the MODEL, so it reasoned as though it held
    // the whole corpus. One line changes what it can conclude from an absence.
    const { text } = loadRules(project(oversized()), () => {})
    expect(text).toMatch(/rule file\(s\) (were )?omitted|omitted for length/i)
  })

  it('test_which_rules_survive_does_not_depend_on_filesystem_order', () => {
    // Two identical checkouts must produce the same prompt. It was `readdir` order, which is
    // OS-dependent — so the surviving set could differ between two machines with the same files.
    const a = loadRules(project(oversized()), () => {}).text
    const b = loadRules(project([...oversized()].reverse()), () => {}).text
    expect(a).toBe(b)
  })

  it('test_a_corpus_that_fits_is_untouched_and_unmarked', () => {
    // Anti-vacuity in both directions: a marker appended unconditionally would satisfy the second
    // arm, and dropping blocks unconditionally would satisfy the first.
    const { text, truncated } = loadRules(
      project([
        ['a.md', '# a\n\nalpha\n'],
        ['b.md', '# b\n\nbeta\n'],
      ]),
      () => {},
    )
    expect(truncated).toBe(false)
    expect(text).toContain('alpha')
    expect(text).toContain('beta')
    expect(text).not.toMatch(/omitted/i)
  })
})
