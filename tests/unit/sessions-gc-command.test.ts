import { describe, expect, it } from 'vitest'

import { formatGcPlan } from '../../packages/theo/src/cli/commands/sessions-gc.js'

/**
 * M72 — the operator-facing half of transcript retention.
 *
 * The plan's correctness is proven in `packages/agents/tests/unit/transcript-gc.test.ts`; what this
 * asserts is the thing the operator actually receives. A retention pass whose output does not say
 * WHICH sessions went and WHY the others stayed cannot be reviewed, and reviewing it is the entire
 * reason `--apply` is not the default.
 */

const plan = {
  cwd: '/p',
  root: '/r',
  candidates: [{ id: 'old-1', transcript: '/r/old-1.jsonl', modifiedAt: new Date(0) }],
  kept: [
    { id: 'live', reason: 'active writer lease' },
    { id: 'recent', reason: 'within the newest 10' },
  ],
}

describe('formatGcPlan', () => {
  it('test_a_dry_run_says_nothing_was_deleted', () => {
    // The single most important line: an operator skimming the output must not mistake a preview
    // for an execution.
    const lines = formatGcPlan(plan, { dryRun: true, removed: ['old-1'], errors: [] })
    expect(lines.join('\n')).toMatch(/dry run/i)
    expect(lines.join('\n')).toMatch(/nothing was deleted/i)
    expect(lines.join('\n')).toMatch(/would remove/i)
  })

  it('test_an_applied_run_does_NOT_claim_to_be_a_dry_run', () => {
    const lines = formatGcPlan(plan, { dryRun: false, removed: ['old-1'], errors: [] })
    expect(lines.join('\n')).not.toMatch(/dry run/i)
    expect(lines.join('\n')).toMatch(/applied/i)
  })

  it('test_every_kept_session_is_printed_WITH_its_reason', () => {
    // "Skipped 4 sessions" tells an operator nothing. "kept because it holds an active writer
    // lease" tells them whether to go stop something.
    const text = formatGcPlan(plan, { dryRun: true, removed: [], errors: [] }).join('\n')
    expect(text).toContain('live — active writer lease')
    expect(text).toContain('recent — within the newest 10')
  })

  it('test_failures_are_printed_and_say_the_rest_still_ran', () => {
    // Fail-open per candidate is only defensible if the operator learns which one failed.
    const text = formatGcPlan(plan, {
      dryRun: false,
      removed: ['old-2'],
      errors: [{ id: 'old-1', message: 'EACCES' }],
    }).join('\n')
    expect(text).toMatch(/old-1/)
    expect(text).toMatch(/EACCES/)
    expect(text).toMatch(/rest still ran/i)
  })

  it('test_an_empty_plan_says_so_rather_than_printing_nothing', () => {
    // Silence reads as failure. "Nothing to collect" is the answer.
    const text = formatGcPlan(
      { ...plan, candidates: [], kept: [] },
      { dryRun: true, removed: [], errors: [] },
    ).join('\n')
    expect(text).toMatch(/nothing to collect/i)
  })
})
