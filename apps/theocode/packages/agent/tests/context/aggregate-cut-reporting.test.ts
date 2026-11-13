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
    const rules = ['R'.repeat(2_000), 'S'.repeat(2_000)].join('\n\n---\n\n')
    const agentsMd = 'A'.repeat(100)
    const composed = composeInstructions('base', { agentsMd, rules }, '', budget(2_000))

    const cut = composed.cuts.find((c) => c.source === 'rules')
    expect(cut?.from).toBe(rules.length)
    expect(cut?.to).toBeLessThan(rules.length)
    expect(composed.cuts.find((c) => c.source === 'agentsMd')).toBeUndefined()
    expect(composed.text.length).toBeLessThanOrEqual(2_000)
  })

  test('a --- rule inside AGENTS.md is not a rules boundary (#1903)', () => {
    const agentsMd = `HEAD-SECTION ${'a'.repeat(500)}\n\n---\n\nTAIL-SECTION ${'b'.repeat(500)}`
    const composed = composeInstructions('BASE', { agentsMd }, '', budget(900))

    expect(composed.cuts.length).toBeGreaterThan(0)
    expect(composed.cuts.every((c) => c.source === 'agentsMd')).toBe(true)
    expect(composed.text).toContain('TAIL-SECTION')
    expect(composed.text).not.toContain('HEAD-SECTION')
    expect(composed.text.length).toBeLessThanOrEqual(900)
  })

  test('rules and an AGENTS.md holding --- are each cut and attributed to their own source', () => {
    const agentsMd = `HEAD ${'a'.repeat(400)}\n\n---\n\nTAIL ${'b'.repeat(400)}`
    const rules = ['R'.repeat(300), 'S'.repeat(300)].join('\n\n---\n\n')
    const composed = composeInstructions('BASE', { agentsMd, rules }, '', budget(900))

    const rulesCut = composed.cuts.find((c) => c.source === 'rules')
    const mdCut = composed.cuts.find((c) => c.source === 'agentsMd')
    expect(rulesCut?.from).toBe(rules.length)
    expect(rulesCut?.to).toBe(0)
    expect(mdCut?.from).toBe(agentsMd.length)
    expect(mdCut?.to).toBeLessThan(agentsMd.length)
    expect(composed.text).toContain('TAIL')
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
    // A plain string is AGENTS.md, so the rules branch finds nothing to trim and the AGENTS.md
    // branch is the one that fires.
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
