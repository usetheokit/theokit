/**
 * #91 — `/status` says whether the rules in the prompt are the rules on disk.
 *
 * The row exists for the reason the `agents.md` row beside it does, stated in its own comment:
 * *"the case that matters is the silent one"*. A truncated rules block is silent by construction —
 * the agent answers normally, having never seen three quarters of what the repository wrote for it.
 *
 * Measured on this product's own checkout at v0.7.0: 248,669 chars against a 64,000 ceiling.
 */
import { describe, expect, it } from 'vitest'

import { rulesRow } from '../../src/commands/command-content.js'

describe('#91 — the rules row', () => {
  it('test_a_complete_load_says_so_without_arithmetic', () => {
    // Positive control, and a deliberate shape choice: the common case must not read like a warning.
    // A row that always printed "12 of 12 · 4,000 chars" would train people to skip it.
    expect(rulesRow({ count: 12, read: 12, chars: 4_000, kept: 4_000, truncated: false })).toBe('12 loaded')
  })

  it('test_a_truncated_load_names_both_halves_and_the_proportion', () => {
    // The defect, as a line. Both halves, because 12 means nothing without the 40 it is out of, and
    // the percentage because 64,000 of 248,669 is arithmetic nobody does at a glance.
    const row = rulesRow({ count: 12, read: 40, chars: 248_669, kept: 64_000, truncated: true })

    expect(row).toContain('12 of 40')
    expect(row).toContain('74% dropped')
  })

  it('test_no_record_yet_is_never_collapsed_into_no_rules', () => {
    // The distinction `agentsMdRow` draws, and the direction that matters: "no agent has been built"
    // and "this project has no rules" are different facts, and reporting the first as the second
    // answers an unasked question reassuringly. Superseded `<not loaded yet>`, which was honest and
    // was not an answer — the row now reads the disk and labels what it finds.
    expect(
      rulesRow(undefined, () => ({ count: 3, read: 3, chars: 900, kept: 900, truncated: false })),
    ).not.toBe('<none>')
  })

  it('test_a_project_with_no_rules_at_all_says_none', () => {
    // Anti-vacuity for the arm above: `<not loaded yet>` hard-coded would satisfy it.
    expect(rulesRow({ count: 0, read: 0, chars: 0, kept: 0, truncated: false })).toBe('<none>')
  })

  it('test_before_the_first_turn_it_reports_what_is_on_disk_and_says_so', () => {
    // Codex answers `/status` immediately because it resolves at startup; this product builds the
    // agent per turn, so before the first one there is no record. `agentsMdRow` already solved this
    // one row up — it walks the disk and labels the answer `on disk`, because the trust gate has
    // not run and what the walk finds is what WOULD load, not what did.
    //
    // `<not loaded yet>` was honest and was not an answer. This says the true thing instead of
    // saying nothing, which is the choice that row's own comment argues for.
    expect(rulesRow(undefined, () => ({ count: 8, read: 34, chars: 246_582, kept: 64_000, truncated: true })))
      .toBe('8 of 34 — 74% dropped (246,582 chars over the ceiling)  (on disk — not loaded yet)')
  })

  it('test_a_disk_read_that_finds_nothing_still_says_none', () => {
    // Anti-vacuity for the arm above: appending the label unconditionally would make an empty
    // project report `<none> (on disk — not loaded yet)`, which reads as though something is pending.
    expect(rulesRow(undefined, () => ({ count: 0, read: 0, chars: 0, kept: 0, truncated: false })))
      .toBe('<none>')
  })
})

describe('B-173 — the row reflects BOTH ceilings, or says which one it saw', () => {
  it('test_a_second_ceiling_cut_is_named_even_when_the_first_passed_everything', () => {
    // The defect this item is about. The loader's ceiling passed the whole block, so `truncated`
    // is false and the row said "12 loaded" — over a corpus the aggregate ceiling had cut by
    // ~30,000 rendered chars downstream, in a warning string no surface could read.
    const row = rulesRow({
      count: 12,
      read: 12,
      chars: 4_000,
      kept: 4_000,
      truncated: false,
      aggregateCut: { from: 50_000, to: 20_000 },
    })

    // `toBe`, not `toContain`: review showed that rendering the two clauses in the wrong order
    // produced "; a later ceiling cut the block from 50,000 to 20,000 chars12 loaded" and passed
    // every containment assertion. One equality pins order, separator and thousands-formatting.
    expect(row).toBe('12 loaded; a later ceiling cut the block from 50,000 to 20,000 chars')
  })

  it('test_the_two_ceilings_are_reported_separately_and_never_as_one_percentage', () => {
    // They measure different things — the first in SOURCE chars from the loader, the second in
    // RENDERED chars from the composed prompt. A single share over two units is a number nobody
    // can check, and computing one is how a reversed attempt printed "0% dropped" over a persona
    // cut to 363 chars.
    const row = rulesRow({
      count: 8,
      read: 34,
      chars: 246_582,
      kept: 64_000,
      truncated: true,
      aggregateCut: { from: 64_000, to: 30_000 },
    })

    expect(row).toBe(
      '8 of 34 — 74% dropped (246,582 chars over the ceiling); a later ceiling cut the block from 64,000 to 30,000 chars',
    )
  })

  it('test_no_second_cut_leaves_the_row_exactly_as_it_was', () => {
    // ANTI-VACUITY CONTROL. Without it, a renderer that always appended a second clause — or one
    // that appended "cut to undefined" — passes both assertions above. The previous attempt at
    // this item shipped with precisely that mutant alive.
    expect(rulesRow({ count: 12, read: 12, chars: 4_000, kept: 4_000, truncated: false })).toBe('12 loaded')
    expect(rulesRow({ count: 8, read: 34, chars: 246_582, kept: 64_000, truncated: true })).toBe(
      '8 of 34 — 74% dropped (246,582 chars over the ceiling)',
    )
  })
})
