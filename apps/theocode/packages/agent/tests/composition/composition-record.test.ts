/**
 * B-173 — the record-boundary half of "a cut must name its source".
 *
 * `withAggregateCut` decides which of the composer's cuts reaches the `/status` rules row. Only
 * a cut whose `source` is `rules` may: the aggregate ceiling can equally trim the surface
 * document or the AGENTS.md chain, and neither is a rule.
 *
 * These tests exist because the filter shipped with none. Review measured that replacing
 * `cuts.find((c) => c.source === 'rules')` with `cuts[0]` passed all 1192 tests in the agent and
 * TUI packages — and then drove the real product to show it is not a harmless mutant: a project
 * holding ONE 18-character rules file, with a 200,000-character surface document, reported
 * "1 loaded; a later ceiling cut the block from 200,000 to 86,346 chars". An intact rule block
 * described as gutted, which is precisely the failure that reversed the previous attempt at
 * this item.
 *
 * Every fixture below puts the rules cut somewhere other than first, or leaves it out entirely.
 * A filter that reads position instead of source cannot pass them.
 */
import { describe, expect, test } from 'vitest'

import { withAggregateCut } from '../../src/composition/composition-record.js'
import type { InstructionCut } from '../../src/context/agents-md.js'

const RECORD = { count: 3, read: 3, chars: 900, kept: 900, truncated: false } as const

const SURFACE: InstructionCut = { source: 'surface', from: 200_000, to: 86_346 }
const AGENTS_MD: InstructionCut = { source: 'agentsMd', from: 40_000, to: 12_000 }
const RULES: InstructionCut = { source: 'rules', from: 900, to: 300 }

describe('B-173 — only a rules cut reaches the rules row', () => {
  test('a surface cut leaves the record untouched', () => {
    // The exact shape review reproduced against the running product.
    expect(withAggregateCut(RECORD, [SURFACE])).toEqual(RECORD)
  })

  test('an agentsMd cut leaves the record untouched', () => {
    expect(withAggregateCut(RECORD, [AGENTS_MD])).toEqual(RECORD)
  })

  test('a rules cut is found even when it is not the first', () => {
    // The arm that kills `cuts[0]`. Both other arms pass under that mutant when the rules cut
    // is absent, so this one carries the whole difference between reading source and reading
    // position — and the composer really can emit two cuts in one composition.
    const record = withAggregateCut(RECORD, [AGENTS_MD, RULES])

    expect(record?.aggregateCut).toEqual({ from: 900, to: 300 })
  })

  test('no cuts at all leaves the record untouched', () => {
    // ANTI-VACUITY CONTROL for the function itself, not for the composer.
    expect(withAggregateCut(RECORD, [])).toEqual(RECORD)
    expect(withAggregateCut(RECORD, [])?.aggregateCut).toBeUndefined()
  })

  test('an absent record stays absent rather than becoming an empty one', () => {
    // `undefined` is documented as distinct from "wired nothing". Unreachable from the sole
    // production caller today — `rulesLoad` always returns an object — so this pins the
    // signature's honesty against the optional field rather than a live path.
    expect(withAggregateCut(undefined, [RULES])).toBeUndefined()
  })
})
