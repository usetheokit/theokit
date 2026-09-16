/**
 * B-173 — `/status` reported the rules as fully loaded over a corpus a second ceiling had cut.
 *
 * Two ceilings act on the rules in series: the loader's (`MAX_CHARS`, source chars) and the
 * aggregate one (`MAX_AGGREGATE`, rendered chars, applied in `composeInstructions`). Only the
 * first reached the wiring record, so a run whose rules were cut by ~30,000 chars downstream
 * still printed "N loaded".
 *
 * The information was never missing — `composeInstructions` says exactly what it cut, in a
 * `warn` STRING that nothing can read. These tests pin the structured form instead.
 *
 * The controls matter more than the positives here. A previous attempt at this item shipped
 * with a mutant alive that its own plan had predicted by name — an unconditional "yes, it was
 * cut" passed every test written for it, because every test asserted a cut. Three of the five
 * below expect NO cut, which is the only shape that can fail such a mutant.
 */
import { describe, expect, test } from 'vitest'
import { MAX_AGGREGATE, composeInstructions } from '../../src/context/agents-md.js'

const silent = (): void => {}
const budget = (maxChars: number) => ({ maxChars, warn: silent })

describe('composeInstructions reports what the aggregate ceiling cut', () => {
  test('a composition that fits reports no cut at all', () => {
    // ANTI-VACUITY CONTROL, and the one that kills the predicted mutant: an implementation
    // that always answers "cut" passes every positive assertion below and fails only here.
    const composed = composeInstructions('base', 'rules doc', 'surface doc', budget(MAX_AGGREGATE))

    expect(composed.cuts).toEqual([])
    expect(composed.text).toContain('base')
  })

  test('cutting the rules names the rules, with the chars on both sides', () => {
    // The rules segment is recognised by the `\n\n---\n\n` separator the loader joins blocks
    // with; without it the whole document reads as AGENTS.md and the cut lands there instead.
    const rules = ['R'.repeat(2_000), 'S'.repeat(2_000)].join('\n\n---\n\n')
    const agentsMd = 'A'.repeat(100)
    const composed = composeInstructions('base', `${agentsMd}\n\n${rules}`, '', budget(2_000))

    const cut = composed.cuts.find((c) => c.source === 'rules')
    expect(cut).toBeDefined()
    // Deliberately NOT asserting `from === rules.length`. `splitProjectDoc` recognises the rules
    // segment from the first `---` onward, so the two differ by the leading block — and a test
    // that pinned the splitter's arithmetic would break on a refactor that changed nothing
    // observable. What must hold is the direction: something was there, less of it survived.
    expect(cut?.from).toBeGreaterThan(0)
    expect(cut?.to).toBeLessThan(cut?.from ?? 0)
    // An upper bound too, because `from` is PRINTED verbatim in the status row: review showed
    // that direction alone let `rules.length + agentsMd.length` through, putting a number on
    // screen that describes a block bigger than the document it came from.
    expect(cut?.from).toBeLessThanOrEqual(`${agentsMd}\n\n${rules}`.length - agentsMd.length)
    expect(composed.text.length).toBeLessThanOrEqual(2_000)
  })

  test('cutting the surface document does NOT report a rules cut', () => {
    // The failure that reversed the previous attempt: the aggregate ceiling can cut
    // `appendInstructions`, which is not a rule, and the RULES row claimed truncation anyway —
    // a 25-char intact load printed "1 of 1 — 0% dropped", false in both numbers.
    const composed = composeInstructions('base', 'tiny rules', 'S'.repeat(4_000), budget(1_000))

    expect(composed.cuts.map((c) => c.source)).toContain('surface')
    expect(composed.cuts.map((c) => c.source)).not.toContain('rules')
  })

  test('cutting the AGENTS.md chain does NOT report a rules cut', () => {
    // The mirror of the surface arm, for the branch that had none. Review measured that
    // relabelling this push `source: 'rules'` — the same defect the surface arm guards —
    // survived all 1192 tests in the agent and TUI packages.
    //
    // A document with no `\n\n---\n\n` separator is entirely AGENTS.md as far as
    // `splitProjectDoc` is concerned, so the first branch finds no rules to trim and the
    // second branch is the one that fires.
    const composed = composeInstructions('base', 'A'.repeat(4_000), '', budget(1_000))

    expect(composed.cuts.map((c) => c.source)).toContain('agentsMd')
    expect(composed.cuts.map((c) => c.source)).not.toContain('rules')
  })

  test('a composition exactly at the ceiling is not a cut', () => {
    // The `>` versus `>=` boundary. The "fits" control sits far from the edge, so nothing
    // pinned what happens ON it — an off-by-one there reports a cut of zero chars.
    const exact = composeInstructions('base', 'rules doc', 'surface doc')

    expect(composeInstructions('base', 'rules doc', 'surface doc', budget(exact.text.length)).cuts).toEqual([])
  })

  test('a non-positive budget is a typed RangeError, not a silent pass', () => {
    // Negative case per `rules/testing.md` § 4.1 — the specific error and its message, not
    // merely "it throws". The sibling loader has exactly this test; the composer did not,
    // and this commit reshaped every return path of the function.
    expect(() => composeInstructions('base', '', '', budget(0))).toThrow(RangeError)
    expect(() => composeInstructions('base', '', '', budget(-1))).toThrow(
      /maxChars=-1 — the aggregate budget must be > 0/,
    )
  })

  test('a base that alone exceeds the ceiling reports no cut, because nothing was cut', () => {
    // `withinBudget`'s last branch warns in words that read like the others and says the
    // opposite: "nothing was truncated". A reporter driven off the warn channel set the flag
    // here too. This test is that branch.
    const composed = composeInstructions('B'.repeat(5_000), '', '', budget(1_000))

    expect(composed.cuts).toEqual([])
    expect(composed.text).toContain('B')
  })

  test('without a budget there is no ceiling, so there is nothing to report', () => {
    const composed = composeInstructions('base', 'rules', 'surface')

    expect(composed.cuts).toEqual([])
  })
})
