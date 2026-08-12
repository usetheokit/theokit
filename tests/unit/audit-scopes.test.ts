import { describe, expect, it } from 'vitest'

import { decideAuditOutcome, summarizeBySeverity } from '../../scripts/audit-scopes.mjs'

/**
 * Which audit scope BLOCKS, and which one merely reports.
 *
 * ## The gap this closes
 *
 * `check:audit` ran `pnpm audit --prod --audit-level=high` and nothing else. That choice is
 * defensible — a high CVE in a production dependency ships to every consumer, while one in `eslint`
 * does not — but it was never *stated*, so the dev-side number simply went unmeasured. Backlog
 * B-M67-11 measured it for the first time: `--prod` reports 6 advisories and **zero high**, the full
 * tree reports 23 with **16 high**, all of them algorithmic-complexity / DoS inside build tooling.
 *
 * ## Why the dev scope reports instead of blocking
 *
 * Those 16 arrive transitively and cannot be fixed here — they need upstream releases. Blocking on
 * them would make the gate permanently red, which is the failure this whole cycle spent its time
 * undoing: a gate nobody can satisfy is a gate nobody reads, and the next *real* finding arrives
 * indistinguishable from the noise.
 *
 * So the scope split becomes explicit and asymmetric: production blocks, development is surfaced
 * with the module names so the number is known rather than assumed to be zero.
 */

const PROD_CLEAN = { high: 0, moderate: 4, low: 2, critical: 0 }
const PROD_DIRTY = { high: 1, moderate: 0, low: 0, critical: 0 }
const DEV_DIRTY = { high: 16, moderate: 5, low: 2, critical: 0 }

describe('decideAuditOutcome — production blocks', () => {
  it('test_a_high_in_a_production_dependency_blocks', () => {
    // It ships to every consumer of the framework. Nothing else in the decision matters.
    const outcome = decideAuditOutcome({ prod: PROD_DIRTY, dev: { ...DEV_DIRTY, high: 0 } })
    expect(outcome.blocking).toBe(true)
    expect(outcome.reason).toMatch(/production/i)
  })

  it('test_a_critical_in_a_production_dependency_blocks', () => {
    const outcome = decideAuditOutcome({
      prod: { high: 0, moderate: 0, low: 0, critical: 1 },
      dev: DEV_DIRTY,
    })
    expect(outcome.blocking).toBe(true)
  })

  it('test_moderate_and_low_in_production_do_NOT_block', () => {
    // The gate's declared level is `high`. Blocking below it would redefine the contract silently.
    const outcome = decideAuditOutcome({
      prod: PROD_CLEAN,
      dev: { high: 0, moderate: 0, low: 0, critical: 0 },
    })
    expect(outcome.blocking).toBe(false)
  })
})

describe('decideAuditOutcome — development reports', () => {
  it('test_a_high_in_a_dev_dependency_does_NOT_block', () => {
    const outcome = decideAuditOutcome({ prod: PROD_CLEAN, dev: DEV_DIRTY })
    expect(outcome.blocking).toBe(false)
  })

  it('test_a_high_in_a_dev_dependency_is_still_REPORTED', () => {
    // Not blocking must never mean not knowing. The whole point of B-M67-11 is that the number
    // stopped being invisible.
    const outcome = decideAuditOutcome({ prod: PROD_CLEAN, dev: DEV_DIRTY })
    expect(outcome.warnings).toHaveLength(1)
    expect(outcome.warnings[0]).toMatch(/16/)
    expect(outcome.warnings[0]).toMatch(/dev/i)
  })

  it('test_a_clean_dev_tree_produces_no_warning', () => {
    const outcome = decideAuditOutcome({
      prod: PROD_CLEAN,
      dev: { high: 0, moderate: 0, low: 0, critical: 0 },
    })
    expect(outcome.warnings).toEqual([])
    expect(outcome.blocking).toBe(false)
  })

  it('test_production_findings_are_not_double_counted_as_dev', () => {
    // `pnpm audit` without `--prod` covers BOTH trees, so the dev count must be the difference.
    // Reporting the raw full-tree number would tell the operator there are dev issues that are in
    // fact the production ones already blocking above.
    const outcome = decideAuditOutcome({
      prod: { high: 2, moderate: 0, low: 0, critical: 0 },
      dev: { high: 2, moderate: 0, low: 0, critical: 0 },
    })
    expect(outcome.warnings).toEqual([])
  })
})

describe('summarizeBySeverity — the counter over pnpm audit JSON', () => {
  it('test_counts_each_severity', () => {
    const counts = summarizeBySeverity({
      advisories: {
        '1': { severity: 'high', module_name: 'a' },
        '2': { severity: 'high', module_name: 'b' },
        '3': { severity: 'moderate', module_name: 'c' },
      },
    })
    expect(counts).toEqual({ critical: 0, high: 2, moderate: 1, low: 0 })
  })

  it('test_an_empty_report_counts_zero_rather_than_crashing', () => {
    // `pnpm audit` emits `{}` when the tree is clean. Treating that as a parse failure would turn
    // the healthiest possible state into a broken gate.
    expect(summarizeBySeverity({})).toEqual({ critical: 0, high: 0, moderate: 0, low: 0 })
  })

  it('test_an_unknown_severity_is_ignored_rather_than_miscounted', () => {
    const counts = summarizeBySeverity({
      advisories: { '1': { severity: 'info', module_name: 'a' } },
    })
    expect(counts).toEqual({ critical: 0, high: 0, moderate: 0, low: 0 })
  })
})
