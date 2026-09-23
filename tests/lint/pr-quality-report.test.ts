import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, it, expect } from 'vitest'

import {
  readPublishingGates,
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

describe('summarise — the report does not count itself', () => {
  // Caught by reading the first report this job ever posted: it listed its own check run as
  // `in_progress` and therefore announced "Not green" while every real gate had passed. A report
  // that can never say green is a report people stop reading.
  it('Given the reporting job itself is running, Then it is excluded entirely', () => {
    const s = summarise([passing('Lint'), running('Quality report (PR comment)')], {
      self: 'Quality report (PR comment)',
    })
    expect(s).toMatchObject({ passed: 1, pending: 0, ok: true })
    expect(s.outstanding).toEqual([])
  })

  it('Given no self name, Then nothing is excluded', () => {
    const s = summarise([passing('Lint'), running('Quality report (PR comment)')])
    expect(s.pending).toBe(1)
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

  it('Given the reporting job itself, Then it is absent from the rendered table', () => {
    const md = renderReport({
      checkRuns: [passing('Lint'), running('Quality report (PR comment)')],
      coverage: COVERAGE,
      sha: 'abc123def',
      self: 'Quality report (PR comment)',
    })
    expect(md).not.toContain('Quality report (PR comment)')
    expect(md).toContain('gates passed')
  })

  it('Always carries the marker the workflow uses to update in place', () => {
    const md = renderReport({ checkRuns: [passing('Lint')], coverage: null, sha: 'abc123def' })
    expect(md).toContain('<!-- theokit:quality-report -->')
  })
})

/**
 * B-268 T1.1 — the declaration, and the absent-file case.
 *
 * `readPublishingGates` reads `rules/publishing-gates.txt`: check names that PUBLISH rather than
 * verify. The absent-file case is FR-003's other half and the one worth a test of its own: a consumer
 * that has not written the file must get exactly today's behaviour, which means an empty set and no
 * throw. A report that dies because a config is missing is a report nobody sees.
 */
describe('readPublishingGates — an absent declaration is an empty one', () => {
  it('Given NO declaration file, Then zero names are declared and behaviour is unchanged', () => {
    const empty = mkdtempSync(join(tmpdir(), 'no-gates-'))
    try {
      expect(readPublishingGates(empty)).toEqual(new Set())
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  it('Given a declaration with comments and blanks, Then only the entry names are read', () => {
    const root = mkdtempSync(join(tmpdir(), 'gates-'))
    try {
      mkdirSync(join(root, 'rules'), { recursive: true })
      writeFileSync(
        join(root, 'rules', 'publishing-gates.txt'),
        [
          '# a comment line is not an entry',
          '',
          'preview / Publish a preview of every publishable package  # publishes to pkg.pr.new',
          '   ',
        ].join('\n'),
      )
      expect(readPublishingGates(root)).toEqual(
        new Set(['preview / Publish a preview of every publishable package']),
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

/**
 * B-268 T2.1 — the third class, in BOTH branches.
 *
 * A declared publishing gate counts toward neither `failed` nor `pending`. The second half is where
 * the bug hides: `summarise` increments `pending` BEFORE any conclusion is read, so a
 * conclusion-based classification never reaches that branch and a publisher that HANGS produces the
 * identical misreading. PR #897 carries a `cancelled` beside the `failure` for the same gate on the
 * same SHA, so a non-completed state is measured rather than hypothetical.
 */
describe('summarise — a declared publishing gate is a third class', () => {
  const PUBLISHING = new Set(['preview'])

  it('Given a DECLARED publishing gate failed, Then it counts as neither passed nor failed', () => {
    const s = summarise([passing('unit'), failing('preview')], { publishing: PUBLISHING })
    expect(s.failed).toBe(0)
    expect(s.passed).toBe(1)
    // The conclusion travels with the name, so a gate appearing twice keeps both — see the
    // run-35820666635 case, where `preview / …` is a `failure` and a `cancelled` on one SHA.
    expect(s.excluded).toEqual([{ name: 'preview', conclusion: 'failure' }])
    expect(s.ok).toBe(true)
  })

  it('Given an UNDECLARED check failed, Then it counts as failed exactly as today', () => {
    const s = summarise([passing('unit'), failing('typecheck')], { publishing: PUBLISHING })
    expect(s.failed).toBe(1)
    expect(s.excluded).toEqual([])
    expect(s.ok).toBe(false)
  })

  it('Given a declared publishing gate never completed, Then it is not counted as pending', () => {
    const s = summarise([passing('unit'), running('preview')], { publishing: PUBLISHING })
    expect(s.pending).toBe(0)
    // `in_progress` rather than a conclusion: the hang path carries the STATUS, because there is no
    // conclusion to carry — which is the branch a conclusion-based classification never reaches.
    expect(s.excluded).toEqual([{ name: 'preview', conclusion: 'in_progress' }])
    expect(s.ok).toBe(true)
  })

  it('Given a verifying gate failed AND the publisher failed, Then it reads not green, naming the test', () => {
    const s = summarise([failing('unit'), failing('preview')], { publishing: PUBLISHING })
    expect(s.failed).toBe(1)
    expect(s.outstanding).toEqual(['unit'])
    expect(s.excluded).toEqual([{ name: 'preview', conclusion: 'failure' }])
    expect(s.ok).toBe(false)
  })

  it('Given one call, Then classification walks the check list exactly once more', () => {
    let reads = 0
    const counted = new Proxy(new Set(['preview']), {
      get(target, prop, receiver) {
        if (prop === 'has') {
          return (name) => {
            reads += 1
            return target.has(name)
          }
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    const runs = [passing('a'), failing('b'), running('c'), failing('preview')]
    summarise(runs, { publishing: counted })
    // One membership test per run and no more: the declaration is consulted inside the existing
    // loop rather than in a second pass over the list.
    expect(reads).toBe(runs.length)
  })

  it('Given the check list is already fetched, Then classification makes no network call', () => {
    const fetchBefore = globalThis.fetch
    let called = 0
    globalThis.fetch = () => {
      called += 1
      return Promise.reject(new Error('classification must not fetch'))
    }
    try {
      const s = summarise([passing('unit'), failing('preview')], { publishing: PUBLISHING })
      // Bound to the NEW path on purpose. `summarise` never fetched, so asserting `called === 0`
      // alone passes today and proves nothing about this change — measured: the case was green
      // before a line of production code moved. Asserting the exclusion happened AND that nothing
      // fetched makes it fail today and hold afterwards, which is what a criterion is for.
      expect(s.excluded).toEqual([{ name: 'preview', conclusion: 'failure' }])
      expect(called).toBe(0)
    } finally {
      globalThis.fetch = fetchBefore
    }
  })
})

/**
 * B-268 T3.1 — the excluded gate is NAMED, and the count is printed even at zero.
 *
 * R1 is the risk this answers: the failure this item could introduce is a preview that silently stops
 * being published and nobody notices. `honesty-gate-golden-rule.md § 7` names that shape, and the only
 * defence is that absence is never inferred — so the count prints at zero too, and a reader never has
 * to decide whether the mechanism ran or found nothing.
 */
describe('renderReport — an excluded gate is named, never silent', () => {
  const PUBLISHING = new Set(['preview'])

  it('Given a gate was excluded, Then the rendered comment names it and its conclusion', () => {
    const body = renderReport({
      checkRuns: [passing('unit'), failing('preview')],
      coverage: COVERAGE,
      sha: 'abc123def',
      publishing: PUBLISHING,
    })
    expect(body).toContain('preview')
    expect(body).toContain('failure')
    expect(body).toMatch(/publishing gate/i)
  })

  it('Given any run, Then the rendered comment states how many gates were excluded', () => {
    const withOne = renderReport({
      checkRuns: [passing('unit'), failing('preview')],
      coverage: COVERAGE,
      sha: 'abc123def',
      publishing: PUBLISHING,
    })
    expect(withOne).toContain('1 publishing gate excluded')

    // Printed at zero too. A reader who has to infer from absence whether the mechanism ran is a
    // reader who cannot tell a working exclusion from a broken one.
    const withNone = renderReport({
      checkRuns: [passing('unit'), passing('typecheck')],
      coverage: COVERAGE,
      sha: 'abc123def',
      publishing: PUBLISHING,
    })
    expect(withNone).toContain('0 publishing gates excluded')
  })
})

/**
 * B-268 T3.2 — a declaration matching no check has quietly stopped applying.
 *
 * This repository already refuses the identical shape for architecture rules:
 * `code-quality-golden-rule.md § 2` caps `vacuous_architecture_rule_{language}` at FAIL_HARD, because
 * a rule naming something no longer in the tree reads as enforced and enforces nothing. Reporting
 * rather than failing is the proportionate form here — the report is not a gate (ADR-3) — but silence
 * would let the exclusion outlive the thing it was written for.
 */
describe('renderReport — a declaration that matches nothing is named', () => {
  it('Given a declared name matching no check in the run, Then it is reported as stale', () => {
    const body = renderReport({
      checkRuns: [passing('unit'), passing('typecheck')],
      coverage: COVERAGE,
      sha: 'abc123def',
      publishing: new Set(['preview / Publish a preview', 'a-check-nobody-runs-any-more']),
    })
    // Both declared names are absent from the run, so BOTH are named — a count alone would let a
    // reader believe one entry had matched.
    expect(body).toContain('a-check-nobody-runs-any-more')
    expect(body).toContain('preview / Publish a preview')
    expect(body).toMatch(/declared .*match(es|ed)? no check|no longer|stale/i)
  })

  it('Given every declared name present in the run, Then nothing is reported as stale', () => {
    const body = renderReport({
      checkRuns: [passing('unit'), failing('preview')],
      coverage: COVERAGE,
      sha: 'abc123def',
      publishing: new Set(['preview']),
    })
    expect(body).not.toMatch(/stale/i)
  })
})

/**
 * B-268 T4.1 — the fixture is run 35820666635's own check list, not a shape somebody imagined.
 *
 * Fetched from the API on 2026-09-23: head_sha `ba47109c5ceabca90554382c947c027d31c7b942`, 41
 * check-runs — 34 success, 5 skipped, 1 failure, 1 cancelled. The failure and the cancelled carry the
 * SAME name, `preview / Publish a preview of every publishable package`, which is the detail nobody
 * would have invented: one gate appearing twice on one SHA, once through the conclusion branch and
 * once through the branch that never reads a conclusion.
 *
 * `pkg-pr-new@0.0.88` answered `Server error (500)` three times through its own retry and then served
 * a Cloudflare error page. `gh run rerun --failed` reproduced it identically.
 */
const RUN_35820666635 = [
  // the two entries for the declared publishing gate, verbatim from the API
  {
    name: 'preview / Publish a preview of every publishable package',
    status: 'completed',
    conclusion: 'failure',
  },
  {
    name: 'preview / Publish a preview of every publishable package',
    status: 'completed',
    conclusion: 'cancelled',
  },
  // five dep-check matrix legs the run skipped
  ...[
    'dep-check / floors the shared pin cannot reach — result',
    'dep-check / suite at the bottom of every declared range',
    'dep-check / floors the shared pin cannot reach',
    'dep-check / consumers this release would strand',
    'dep-check / the floor only some packages claim',
  ].map((name) => ({ name, status: 'completed', conclusion: 'skipped' })),
  // the gates that assert something about the code, all green
  ...[
    'CI',
    'SonarCloud Code Analysis',
    'sonar / SonarQube Cloud',
    'Unit + Type tests (22)',
    'Unit + Type tests (22.12)',
    'Typecheck + Build',
    'Lint + Format',
    'Package validation (publint + ATTW + smoke)',
    'TheoCode (the consumer that validates this framework)',
    'trufflehog / TruffleHog',
    'lint / actionlint + zizmor',
    'SAST status',
    'dep-check / dependency gate',
    'promotion-gate / develop accepts only workspace',
  ].map((name) => ({ name, status: 'completed', conclusion: 'success' })),
]

describe('the real outage — run 35820666635 reads green', () => {
  it('Given the check list from run 35820666635, Then the verdict reads green', () => {
    const publishing = new Set(['preview / Publish a preview of every publishable package'])
    const s = summarise(RUN_35820666635, { publishing })

    expect(s.failed).toBe(0)
    expect(s.pending).toBe(0)
    expect(s.ok).toBe(true)
    // BOTH entries for the declared gate are excluded — the failure through the conclusion branch
    // and the cancelled through the one that never reads a conclusion.
    expect(s.excluded).toHaveLength(2)

    const body = renderReport({
      checkRuns: RUN_35820666635,
      coverage: COVERAGE,
      sha: 'ba47109c5',
      publishing,
    })
    expect(body).toContain('2 publishing gates excluded')
    expect(body).not.toContain('Not green.')

    // Found by RUNNING the script against this fixture rather than by testing it: `byName` was a Map
    // keyed by name, so two check-runs sharing one name collapsed and the LAST conclusion won — both
    // lines rendered `cancelled` and the failure was lost. Two entries with the same name is exactly
    // what this run has, and no synthetic fixture would have had it.
    // Isolated to the excluded lines. Asserting `toContain('`failure`')` over the whole body passes
    // from the checks TABLE, which lists every run with its conclusion — an assertion satisfiable
    // elsewhere in the same string is not an assertion about the part it names.
    const excludedLines = body
      .split('\n')
      .filter((l) => l.startsWith('- preview / Publish a preview'))
    expect(excludedLines).toHaveLength(2)
    expect(excludedLines.join(' ')).toContain('`failure`')
    expect(excludedLines.join(' ')).toContain('`cancelled`')
  })
})
