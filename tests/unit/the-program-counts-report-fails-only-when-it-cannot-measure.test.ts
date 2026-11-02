/**
 * `pnpm check:pillars` and the TheoClaw parity ledger ran in no workflow, so their counts moved
 * where nobody saw them. `program-counts.yml` now runs both on a schedule through
 * `report-program-counts.mjs`, which writes the counts to the job summary.
 *
 * Both checkers exit 1 while the program they measure is unfinished (pillars pending, parity rows
 * open). That is a state, not a defect, and decision D8 of the pillar-map plan keeps it out of the
 * merge gate. So the report fails only when an instrument could not measure: a checker that exits
 * with anything but 0 or 1, prints no counts line, or (parity) could not parse its sources.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { judgeRun, runAll } from '../../scripts/report-program-counts.mjs'

const REPO = resolve(__dirname, '../..')

describe('judgeRun', () => {
  it('test_an_unfinished_pillar_map_is_measured', () => {
    const verdict = judgeRun('pillars', 1, 'goals: pending\n33 of 33 pillars not proven\n')

    expect(verdict.measured).toBe(true)
    expect(verdict.headline).toBe('33 of 33 pillars not proven')
  })

  it('test_open_parity_rows_are_measured', () => {
    const verdict = judgeRun('parity', 1, 'shipped 26 · out 12 · open 75\nOC-1 open: no check\n')

    expect(verdict.measured).toBe(true)
    expect(verdict.headline).toBe('shipped 26 · out 12 · open 75')
  })

  it('test_a_pillar_map_that_cannot_be_read_is_not_measured', () => {
    expect(judgeRun('pillars', 2, 'cannot read docs/program/pillar-map.json\n').measured).toBe(
      false,
    )
  })

  it('test_a_parity_ledger_whose_sources_do_not_parse_is_not_measured', () => {
    const output =
      'shipped 0 · out 0 · open 0\ninventory source-parse: expected 106 rows, found 0\n'

    expect(judgeRun('parity', 1, output).measured).toBe(false)
  })

  it('test_output_with_no_counts_line_is_not_measured', () => {
    expect(judgeRun('parity', 1, 'TypeError: boom\n').measured).toBe(false)
    expect(judgeRun('pillars', 1, 'TypeError: boom\n').measured).toBe(false)
  })
})

describe('the real checkers', () => {
  it('test_both_checkers_measure_the_current_tree', () => {
    const report = runAll(REPO)

    expect(report.ok).toBe(true)
    expect(report.markdown).toMatch(/pillars not proven|pillars proven/)
    expect(report.markdown).toMatch(/shipped \d+ · out \d+ · open \d+/)
  })
})

describe('program-counts.yml', () => {
  const workflow = parse(
    readFileSync(resolve(REPO, '.github/workflows/program-counts.yml'), 'utf8'),
  ) as { on: Record<string, unknown>; jobs: Record<string, { steps: { run?: string }[] }> }

  it('test_it_runs_on_a_schedule_and_on_dispatch_and_never_gates_a_merge', () => {
    expect(Object.keys(workflow.on).sort((a, b) => a.localeCompare(b))).toEqual([
      'schedule',
      'workflow_dispatch',
    ])
  })

  it('test_it_runs_the_report', () => {
    const runs = Object.values(workflow.jobs).flatMap((job) => job.steps.map((s) => s.run ?? ''))

    expect(runs.some((r) => r.includes('node scripts/report-program-counts.mjs'))).toBe(true)
  })
})
