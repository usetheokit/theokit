import { describe, it, expect } from 'vitest'

import {
  renderReport,
  summarise,
  // @ts-expect-error — plain .mjs gate script, typed here rather than shipped with declarations
} from '../../scripts/pr-quality-report.mjs'

/**
 * The report this produces replaces one a person was assembling by hand, which is the reason it has
 * to be at least as honest as that person was trying to be. Every case below is a way a generated
 * report can lie: by rounding a pending check up to green, by printing a coverage number it never
 * read, or by summarising a failure into a total that hides it.
 */

const passing = (name: string) => ({ name, status: 'completed', conclusion: 'success' })
const failing = (name: string) => ({ name, status: 'completed', conclusion: 'failure' })
const running = (name: string) => ({ name, status: 'in_progress', conclusion: null })

const COVERAGE = {
  lines: { pct: 87.08, covered: 12193, total: 14002 },
  statements: { pct: 85.29, covered: 13374, total: 15679 },
  functions: { pct: 86.08, covered: 2734, total: 3176 },
  branches: { pct: 78.52, covered: 7689, total: 9792 },
}

describe('summarise — a pending check is not a passing one', () => {
  it('Given every check passed, Then the summary says so and nothing is outstanding', () => {
    const s = summarise([passing('Lint'), passing('Tests')])
    expect(s).toMatchObject({ passed: 2, failed: 0, pending: 0, ok: true })
    expect(s.outstanding).toEqual([])
  })

  it('Given a check is still running, Then it is counted as pending and the report is NOT ok', () => {
    const s = summarise([passing('Lint'), running('Tests')])
    expect(s.pending).toBe(1)
    expect(s.passed).toBe(1)
    // The invariant: "I could not tell yet" must never resolve to "green".
    expect(s.ok).toBe(false)
    expect(s.outstanding).toContain('Tests')
  })

  it('Given a check failed, Then it is named rather than folded into a count', () => {
    const s = summarise([passing('Lint'), failing('Coverage gate')])
    expect(s.failed).toBe(1)
    expect(s.ok).toBe(false)
    expect(s.outstanding).toContain('Coverage gate')
  })

  it('Given a check was skipped, Then it counts as neither passed nor failed', () => {
    const s = summarise([
      passing('Lint'),
      { name: 'Claude', status: 'completed', conclusion: 'skipped' },
    ])
    expect(s).toMatchObject({ passed: 1, failed: 0, pending: 0, skipped: 1, ok: true })
  })

  it('Given no checks at all, Then it is NOT reported as green', () => {
    const s = summarise([])
    expect(s.ok).toBe(false)
  })
})

describe('renderReport — it prints what it read, and says when it read nothing', () => {
  it('Given coverage, Then every axis is rendered with its measured ratio', () => {
    const md = renderReport({ checkRuns: [passing('Lint')], coverage: COVERAGE, sha: 'abc123def' })
    expect(md).toContain('87.08')
    expect(md).toContain('12193')
    expect(md).toContain('14002')
    expect(md).toContain('78.52') // branches, the weakest axis, is not omitted
  })

  it('Given NO coverage artifact, Then it says so instead of printing a number', () => {
    const md = renderReport({ checkRuns: [passing('Lint')], coverage: null, sha: 'abc123def' })
    expect(md).not.toMatch(/\d+\.\d+\s*%/)
    expect(md).toMatch(/was not read/i)
  })

  it('Given a failing check, Then its name appears in the report body', () => {
    const md = renderReport({
      checkRuns: [passing('Lint'), failing('Unit + Type tests (22.12)')],
      coverage: COVERAGE,
      sha: 'abc123def',
    })
    expect(md).toContain('Unit + Type tests (22.12)')
  })

  it('Given a pending check, Then the report does not claim everything is green', () => {
    const md = renderReport({
      checkRuns: [passing('Lint'), running('Unit + Type tests (22)')],
      coverage: COVERAGE,
      sha: 'abc123def',
    })
    expect(md).toContain('Unit + Type tests (22)')
    expect(md).not.toMatch(/gates passed/i)
  })

  it('Given a sha, Then the report states which commit it measured', () => {
    const md = renderReport({ checkRuns: [passing('Lint')], coverage: COVERAGE, sha: 'abc123def' })
    expect(md).toContain('abc123def')
  })

  it('Always carries the marker the workflow uses to update in place', () => {
    const md = renderReport({ checkRuns: [passing('Lint')], coverage: null, sha: 'abc123def' })
    expect(md).toContain('<!-- theokit:quality-report -->')
  })
})
