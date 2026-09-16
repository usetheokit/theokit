/**
 * #126 — `/compact` reported a real measurement of the wrong quantity.
 *
 * The toast said `Context compacted (~348→~188 tokens)` while the footer read `40.3k/121.6k context`
 * before AND after. Two numbers for "context" in one frame, and the only readings available to a
 * user were "the compaction is broken" or "the meter is broken". Neither is what happened.
 *
 * What each number measures, measured: `preTokens`/`postTokens` come from the SDK's compaction and
 * count the TEXT of user/assistant/system messages. `tool_use` and `tool_result` blocks are not
 * counted — and, measured on a real session, they are ~83% of the transcript. The footer is
 * `lastUsage.inputTokens`, which is the real figure and does not change until the next turn.
 *
 * The compaction itself WORKS: 28.7k → 5.5k on a real session, an 81% reduction, with tool output
 * genuinely removed. Not being counted is not the same as not being removed, and the first version
 * of this finding inferred the second from the first without testing it.
 *
 * So the numbers stay and are LABELLED — the M94 shape from `SessionFooter.tsx`, one line above the
 * meter this contradicted: a figure whose confidence differs from a measurement has to present
 * itself as such, or people trust it as one.
 */
import { describe, expect, it } from 'vitest'

import { compactReport } from '../../src/commands/compact-report.js'

describe('what the toast says', () => {
  it('test_it_does_not_call_the_number_context', () => {
    // The whole defect in one assertion: "context" on screen means the footer's quantity, and this
    // number is a different one. Reusing the word is what put two answers in one frame.
    expect(compactReport(348, 188)).not.toMatch(/context compacted/i)
  })

  it('test_it_says_what_the_numbers_actually_count', () => {
    expect(compactReport(348, 188)).toContain('message text')
  })

  it('test_it_says_tool_output_was_compacted_but_not_counted', () => {
    // The half that stops the number reading as "it barely did anything". Tool output is usually the
    // bulk of a transcript and it IS removed.
    const said = compactReport(348, 188).toLowerCase()
    expect(said).toContain('tool output')
    expect(said).toContain('not counted')
  })

  it('test_it_points_at_the_figure_that_is_the_context_meter', () => {
    // Otherwise the user is left holding a number they cannot reconcile with the footer.
    expect(compactReport(348, 188)).toMatch(/next turn/)
  })

  it('test_the_numbers_are_still_there', () => {
    // Anti-vacuity floor: deleting them would "fix" every arm above and take the measurement away.
    const said = compactReport(348, 188)
    expect(said).toContain('348')
    expect(said).toContain('188')
  })
})
