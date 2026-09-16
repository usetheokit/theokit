import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  BEHIND,
  CURRENT,
  MARKER,
  UNMEASURED,
  behindRows,
  classify,
  decide,
  fingerprint,
  readFingerprint,
  renderBody,
  runChecker,
} from './report-theokit-staleness.mjs'

const row = (over = {}) => ({
  name: '@theokit/sdk',
  installed: '5.3.2',
  latest: '5.3.3',
  channel: 'latest',
  major: false,
  current: false,
  declarations: [{ label: 'packages/agent', field: 'dependencies', range: '5.3.2' }],
  ...over,
})

const clean = { rows: [row({ current: true, latest: '5.3.2' })], failures: [] }
const stale = { rows: [row()], failures: [] }

describe('classifying what the checker said', () => {
  it('test_exit_zero_with_nothing_behind_is_current', () => {
    expect(classify(0, clean)).toBe(CURRENT)
  })

  it('test_exit_one_naming_a_behind_row_is_behind', () => {
    expect(classify(1, stale)).toBe(BEHIND)
  })

  it('test_exit_two_is_unmeasured_and_never_current', () => {
    // The whole point of the third state. Reading a failed check as "current" would close the
    // issue — reporting a problem as solved because nobody could measure it.
    expect(classify(2, null)).toBe(UNMEASURED)
    expect(classify(2, clean)).toBe(UNMEASURED)
  })

  it('test_a_null_report_is_unmeasured_whatever_the_exit_code_was', () => {
    // Unparseable stdout with a zero exit: the process succeeded and said nothing readable.
    expect(classify(0, null)).toBe(UNMEASURED)
  })

  it('test_an_exit_code_contradicting_its_own_report_is_unmeasured', () => {
    // `1` means behind, so a `1` with no behind row is the checker disagreeing with itself. Acting
    // on it would open an issue that lists nothing.
    expect(classify(1, clean)).toBe(UNMEASURED)
    // And the mirror: `0` while a row says otherwise.
    expect(classify(0, stale)).toBe(UNMEASURED)
  })
})

describe('deciding what to do', () => {
  it('test_it_opens_when_behind_and_nothing_is_open', () => {
    const plan = decide({ exitCode: 1, report: stale, existing: null })
    expect(plan.action).toBe('open')
    expect(plan.rows).toHaveLength(1)
  })

  it('test_it_leaves_an_open_issue_alone_when_the_answer_did_not_change', () => {
    const existing = { number: 7, fingerprint: fingerprint([row()]) }
    expect(decide({ exitCode: 1, report: stale, existing }).action).toBe('unchanged')
  })

  it('test_it_edits_when_the_set_changed', () => {
    const existing = { number: 7, fingerprint: '@theokit/sdk@5.3.1->5.3.2' }
    const plan = decide({ exitCode: 1, report: stale, existing })
    expect(plan.action).toBe('edit')
    expect(plan.number).toBe(7)
  })

  it('test_it_closes_when_the_pins_caught_up', () => {
    const plan = decide({ exitCode: 0, report: clean, existing: { number: 7, fingerprint: 'x' } })
    expect(plan.action).toBe('close')
  })

  it('test_a_failed_check_never_closes_an_open_issue', () => {
    // The case this file exists to get right, and the one a mechanism gets wrong by folding three
    // states into two: the pins are unchanged AND unexamined, both true at once.
    const plan = decide({ exitCode: 2, report: null, existing: { number: 7, fingerprint: 'x' } })
    expect(plan.action).toBe('comment-unmeasured')
    expect(plan.action).not.toBe('close')
  })

  it('test_a_failed_check_never_opens_an_issue_either', () => {
    // The mirror failure: an npm outage filing an issue that names versions nobody read.
    expect(decide({ exitCode: 2, report: null, existing: null }).action).toBe('none')
  })

  it('test_a_version_a_human_closed_is_not_reopened', () => {
    // #159. The human measured this exact delta and declined it; re-opening weekly overrides that
    // decision on a schedule.
    const declined = fingerprint([row()])
    const plan = decide({ exitCode: 1, report: stale, existing: null, declined })
    expect(plan.action).toBe('declined')
  })

  it('test_declining_one_version_does_not_hide_the_next', () => {
    // The half that keeps the silence narrow. Without it, closing the issue once mutes the
    // mechanism forever — a worse failure than the one it fixes.
    const plan = decide({
      exitCode: 1,
      report: stale,
      existing: null,
      declined: '@theokit/sdk@5.3.1->5.3.2',
    })
    expect(plan.action).toBe('open')
  })

  it('test_an_issue_open_for_a_newer_fact_closes_when_the_fact_returns_to_a_declined_one', () => {
    // #163, and it was a live sequence, not a hypothetical: 5.3.3 declined; upstream then moved the
    // `latest` dist-tag backwards to 4.63.5, which is a different fingerprint and correctly opened
    // an issue; when `latest` is restored the state RETURNS to the declined one.
    //
    // With the declined check after `existing`, that last step is `edit` — the issue is rewritten
    // to describe versions a human already ruled on, and stays open forever describing a decision
    // that was taken.
    const existing = { number: 162, fingerprint: '@theokit/sdk@5.3.2->4.63.5' }
    const plan = decide({
      exitCode: 1,
      report: stale,
      existing,
      declined: '@theokit/sdk@5.3.2->5.3.3',
    })
    expect(plan.action).toBe('close-declined')
    expect(plan.number).toBe(162)
  })

  it('test_an_open_issue_for_an_undeclined_fingerprint_is_still_edited', () => {
    // The control beside it: closing on ANY declined value would close issues about versions
    // nobody ruled on, which is the same defect pointing the other way.
    const existing = { number: 7, fingerprint: '@theokit/sdk@5.3.1->5.3.2' }
    const plan = decide({
      exitCode: 1,
      report: stale,
      existing,
      declined: '@theokit/sdk@5.0.0->5.0.1',
    })
    expect(plan.action).toBe('edit')
  })

  it('test_a_declined_fingerprint_never_suppresses_the_unmeasured_state', () => {
    // Declining a VERSION says nothing about a check that could not run.
    const declined = fingerprint([row()])
    expect(decide({ exitCode: 2, report: null, existing: null, declined }).action).toBe('none')
  })

  it('test_nothing_happens_when_current_and_nothing_is_open', () => {
    expect(decide({ exitCode: 0, report: clean, existing: null }).action).toBe('none')
  })
})

describe('the body', () => {
  it('test_it_carries_the_marker_and_a_readable_fingerprint', () => {
    // The two facts the NEXT run reads back. Without them it cannot tell its own issue from
    // anyone else's, and cannot tell a changed answer from an identical one.
    const body = renderBody([row()], { now: '2026-09-08' })
    expect(body).toContain(MARKER)
    expect(readFingerprint(body)).toBe('@theokit/sdk@5.3.2->5.3.3')
  })

  it('test_a_body_predating_the_convention_reads_as_no_fingerprint', () => {
    expect(readFingerprint('an issue somebody wrote by hand')).toBeNull()
    expect(readFingerprint(undefined)).toBeNull()
  })

  it('test_it_names_a_major_rather_than_listing_it_like_the_rest', () => {
    const body = renderBody([row({ major: true, latest: '6.0.0' })], { now: '2026-09-08' })
    expect(body).toContain('major')
    expect(body).toContain('changelog')
  })

  it('test_it_does_not_shout_when_no_row_is_a_major', () => {
    // Negative control: an unconditional warning is one nobody reads by the third issue.
    expect(renderBody([row()], { now: '2026-09-08' })).not.toContain('⚠️')
  })

  it('test_every_declaration_site_is_named', () => {
    // Being behind is only actionable if you know which files pin it.
    const body = renderBody(
      [
        row({
          declarations: [
            { label: 'theocode (root)', field: 'dependencies', range: '5.3.2' },
            { label: 'packages/agent', field: 'dependencies', range: '5.3.2' },
          ],
        }),
      ],
      { now: '2026-09-08' },
    )
    expect(body).toContain('theocode (root)')
    expect(body).toContain('packages/agent')
  })

  it('test_it_tells_the_reader_that_closing_it_is_honoured', () => {
    // A mechanism that respects a decision nobody knows it respects is a mechanism whose users
    // keep re-litigating the same version.
    expect(renderBody([row()], { now: '2026-09-08' })).toContain('Declining is a valid answer')
  })
})

describe('reading the checker report', () => {
  it('test_only_rows_the_checker_marked_not_current_are_reported', () => {
    const mixed = { rows: [row(), row({ name: '@theokit/tui', current: true })], failures: [] }
    expect(behindRows(mixed).map((r) => r.name)).toEqual(['@theokit/sdk'])
  })

  it('test_a_malformed_report_yields_no_rows_rather_than_throwing', () => {
    expect(behindRows(null)).toEqual([])
    expect(behindRows({})).toEqual([])
  })

  it('test_the_fingerprint_does_not_depend_on_row_order', () => {
    // Two runs that found the same thing must compare equal, or the issue is edited forever.
    const a = [row(), row({ name: '@theokit/tui', installed: '0.80.0', latest: '0.81.0' })]
    expect(fingerprint(a)).toBe(fingerprint([...a].reverse()))
  })
})

/**
 * Every temporary root this file makes, removed when it finishes — the pattern from
 * `packages/agent/tests/aggregate-cut-wiring.test.ts:44-57`, inline because `tools/` is not a
 * package and has no `src/` to hang a helper module off (`rules/testing.md` § 5).
 */
const made = []

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
  made.length = 0
})

describe('the wiring between the checker and the decision', () => {
  const rootWith = (script) => {
    const root = mkdtempSync(join(tmpdir(), 'stale-'))
    made.push(root)
    mkdirSync(join(root, 'tools'))
    writeFileSync(join(root, 'tools', 'check-theokit-updates.mjs'), script)
    return root
  }

  it('test_a_checker_that_fails_arrives_as_exit_two_not_as_current', () => {
    // The unit tests above prove `decide` treats exit 2 correctly. This proves the exit code
    // actually REACHES it — `execFileSync` throws on a non-zero exit, and swallowing that throw is
    // how a broken check would have been read as a clean one.
    const root = rootWith('process.exit(2)\n')
    const { exitCode, report } = runChecker(root)
    expect(exitCode).toBe(2)
    expect(classify(exitCode, report)).toBe(UNMEASURED)
  })

  it('test_a_behind_run_arrives_as_exit_one_with_its_report', () => {
    // Positive control beside the negative: without it, a `runChecker` that always returned 2
    // would pass the test above.
    const root = rootWith(
      'console.log(JSON.stringify({rows:[{name:"@theokit/sdk",installed:"1.0.0",' +
        'latest:"1.0.1",channel:"latest",major:false,current:false,declarations:[]}],' +
        'failures:[]}));process.exit(1)\n',
    )
    const { exitCode, report } = runChecker(root)
    expect(exitCode).toBe(1)
    expect(classify(exitCode, report)).toBe(BEHIND)
  })

  it('test_unparseable_output_on_a_zero_exit_is_not_read_as_current', () => {
    const root = rootWith('console.log("not json at all")\n')
    const { exitCode, report } = runChecker(root)
    expect(exitCode).toBe(0)
    expect(report).toBeNull()
    expect(classify(exitCode, report)).toBe(UNMEASURED)
  })
})
