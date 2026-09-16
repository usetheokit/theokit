/**
 * B-137 — the first thing the CLI does was an unbounded subprocess that misreported its own failure.
 *
 * `gitGate` runs `git rev-parse --is-inside-work-tree` before anything else, and it ran it with no
 * timeout at all. A git that hangs — a network-backed working tree, a stale `index.lock`, a
 * credential helper waiting on a prompt — hung the CLI forever, with no output and no bound.
 *
 * The second half is the diagnosis. Every failure took the same branch and printed "Not inside a git
 * repository", so a hang, a missing binary and a genuinely non-git directory were reported as the
 * same thing, and only one of them was true. That is the shape B-130 fixed one layer up, where the
 * transport's retries turned a 401 into a 429.
 *
 * Found 2026-09-03 by RE-MEASURING the finding that produced B-128 instead of trusting that it had
 * been fixed: the original sweep counted three hard-coded call sites and never saw this one, which
 * had no timeout to count.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

/**
 * Scratch roots, removed when the file finishes.
 *
 * MEASURED 2026-09-03: /tmp held 2 773 leaked `theocode-*` directories from suites that create one
 * per case and never remove it. Sixteen other test files here already clean up, so this follows the
 * convention rather than inventing one, and the cost of skipping it is paid once per test on every
 * machine that ever runs the suite.
 */
const roots: string[] = []
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

import { gitGate } from '../../src/runtime/preflight.js'

describe('gitGate', () => {
  it('test_it_passes_inside_a_git_repository', () => {
    // This suite runs inside one. The anti-vacuity floor for everything below.
    const reported: string[] = []
    expect(() => gitGate(false, { onWarn: (m) => reported.push(m) })).not.toThrow()
    expect(reported).toEqual([])
  })

  it('test_skipping_the_gate_runs_no_subprocess_at_all', () => {
    const reported: string[] = []
    gitGate(true, {
      onWarn: (m) => reported.push(m),
      run: () => {
        throw new Error('the gate ran git despite --skip-git-repo-check')
      },
    })
    expect(reported).toEqual([])
  })

  it('test_a_failure_reports_the_real_reason_rather_than_only_the_verdict', () => {
    // The misdiagnosis. "Not inside a git repository" is one explanation among several, and it was
    // printed for all of them.
    const reported: string[] = []
    let exited: number | undefined

    gitGate(false, {
      onWarn: (m) => reported.push(m),
      run: () => ({ ok: false, stdout: '' }),
      onRefuse: (code) => {
        exited = code
      },
      reason: 'git: command not found',
    })

    expect(exited).toBe(1)
    expect(reported.join(' '), 'the reason git actually gave was discarded').toContain(
      'git: command not found',
    )
  })

  it('test_the_subprocess_is_bounded', () => {
    // The bound is the finding. A gate with no timeout is not a gate — it is a place the CLI can
    // stop forever, before it has printed anything a user could act on.
    let seenTimeout: number | undefined

    gitGate(false, {
      onWarn: () => {},
      run: (timeoutMs) => {
        seenTimeout = timeoutMs
        return { ok: true, stdout: 'true\n' }
      },
    })

    expect(seenTimeout, 'the git call was made with no timeout').toBeTypeOf('number')
    expect(seenTimeout).toBeGreaterThan(0)
  })
})

/**
 * The DEFAULT path, with no stubs — the one production actually runs.
 *
 * The tests above inject `run` and `reason`, which proves the rendering and proves nothing about the
 * wiring: in production `reason` is filled by a closure handed to `createGitRunner`'s `onWarn`, and
 * that assignment has to happen before the message is composed. It does, because the seam calls
 * `onWarn` synchronously inside its `catch` — but "it does" is an argument, and an argument is not a
 * test. Reverting the seam to a silent swallow would leave every test above green.
 *
 * This one changes the working directory, which is process-global. It is restored in `finally`, and
 * vitest runs the tests of one file sequentially in one worker, so the blast radius is this file.
 */
describe('gitGate on the real path', () => {
  it('test_outside_a_repository_the_warning_carries_what_git_actually_said', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'theocode-gitgate-'))
    roots.push(scratch)
    const original = process.cwd()
    const reported: string[] = []
    let exited: number | undefined

    try {
      process.chdir(scratch)
      // No `run`, no `reason`: the closure inside gitGate is what must populate the message.
      gitGate(false, {
        onWarn: (m) => reported.push(m),
        onRefuse: (code) => {
          exited = code
        },
      })
    } finally {
      process.chdir(original)
    }

    expect(exited, 'the gate did not refuse outside a repository').toBe(1)
    const message = reported.join(' ')
    expect(message).toContain('Not inside a git repository')
    // The half that only the real closure can produce: git's own words, not our guess at them.
    expect(message, 'the reason git gave never reached the message').toMatch(
      /not a git repository|rev-parse/i,
    )
  })
})

describe('a failure git did not explain', () => {
  it('test_the_message_does_not_trail_an_empty_dash_when_there_is_no_reason', () => {
    // The other side of the branch that carries B-137's whole point. When git DID say something the
    // message appends it; when it said nothing — a runner that fails without writing to stderr — the
    // separator must not be printed with nothing after it. A line ending in " — " reads as truncated
    // output, which is a second false signal on top of the failure being reported.
    const warnings: string[] = []

    gitGate(false, {
      onWarn: (m) => warnings.push(m),
      onRefuse: () => {},
      run: () => ({ ok: false, stdout: '' }),
      reason: '',
    })

    expect(warnings.join('')).not.toContain(' — ')
    expect(warnings.join(''), 'the verdict itself went missing').toContain('Not inside a git repository')
  })

  it('test_the_gate_still_refuses_when_git_gave_no_reason', () => {
    // Anti-vacuity: a gate that stopped refusing would satisfy the assertion above.
    let refused: number | undefined

    gitGate(false, {
      onWarn: () => {},
      onRefuse: (code) => {
        refused = code
      },
      run: () => ({ ok: false, stdout: '' }),
      reason: '',
    })

    expect(refused).toBe(1)
  })
})
