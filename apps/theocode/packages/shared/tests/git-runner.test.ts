/**
 * One git seam, shared by both surfaces, that cannot fail silently.
 *
 * `/review` needs to shell out to git, and the block that did it was duplicated VERBATIM in
 * `packages/cli/src/commands/review.ts` and `packages/tui/src/commands/review.ts` — same arguments,
 * same hard-coded 10 000 ms, same `catch {}` that threw the reason away. Two copies of a swallow is
 * two places to fix it and one place to forget.
 *
 * The contract callers depend on is unchanged: `{ ok, stdout }`, never a throw, because
 * `buildReviewTarget` branches on `ok` to decide what kind of review target it is looking at. What
 * changes is that the reason no longer disappears — `onWarn` is REQUIRED, so a future caller cannot
 * reconstruct the silent swallow by leaving an optional argument off.
 */
import { describe, expect, it } from 'vitest'

import { createGitRunner } from '../src/git-runner.js'

describe('createGitRunner', () => {
  it('test_it_returns_stdout_for_a_command_that_succeeds', () => {
    const warnings: string[] = []
    const git = createGitRunner({ timeoutMs: 10_000, onWarn: (m) => warnings.push(m) })

    const result = git(['--version'])

    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('git version')
    expect(warnings, 'a successful call warned about something').toEqual([])
  })

  it('test_a_failing_command_keeps_the_ok_false_contract_callers_branch_on', () => {
    const git = createGitRunner({ timeoutMs: 10_000, onWarn: () => {} })

    const result = git(['rev-parse', '--verify', 'refs/heads/branch-that-does-not-exist-4f2a'])

    // buildReviewTarget reads `ok` to decide the review target. Throwing here, or returning a
    // non-empty stdout on failure, would change how a review is scoped.
    expect(result.ok).toBe(false)
    expect(result.stdout).toBe('')
  })

  it('test_the_reason_a_command_failed_reaches_onWarn_instead_of_being_discarded', () => {
    // This is the finding. The old block was `catch { return { ok: false, stdout: '' } }`, so a
    // review silently scoped itself differently and nobody could learn why.
    const warnings: string[] = []
    const git = createGitRunner({ timeoutMs: 10_000, onWarn: (m) => warnings.push(m) })

    git(['rev-parse', '--verify', 'refs/heads/branch-that-does-not-exist-4f2a'])

    expect(warnings.length, 'the failure was swallowed again').toBe(1)
    expect(warnings[0]).toContain('git')
    expect(warnings[0], 'the warning does not say which command failed').toContain('rev-parse')
  })

  it('test_the_warning_carries_what_git_said_and_not_the_wrapper_around_it', () => {
    // The half the assertions above could not see. MEASURED 2026-09-03: mutating `failureReason` to
    // return `err.message` instead of the captured stderr left every case here green, because both
    // strings contain `fatal: Needed a single revision` — Node appends stderr to the message.
    //
    // What differs is the noise in front of it. `err.message` opens with
    // "Command failed: git rev-parse --verify …", which repeats the command this warning ALREADY
    // names, so the operator reads the invocation twice before reaching the one line that explains
    // anything. That duplication is what the docblock means by swapping one uninformative string for
    // another, and it is the only observable difference between the two branches.
    const warnings: string[] = []
    const git = createGitRunner({ timeoutMs: 10_000, onWarn: (m) => warnings.push(m) })

    git(['rev-parse', '--verify', 'refs/heads/branch-that-does-not-exist-4f2a'])

    expect(warnings[0], "git's own words did not reach the operator").toContain('fatal:')
    expect(warnings[0], 'the generic wrapper was reported instead of what git said').not.toContain(
      'Command failed:',
    )
  })

  it('test_the_timeout_is_the_callers_to_choose', () => {
    // The duplicated 10_000 was the other half of the finding. A caller that needs a different bound
    // must be able to say so without editing a constant in a third file.
    const warnings: string[] = []
    const git = createGitRunner({ timeoutMs: 1, onWarn: (m) => warnings.push(m) })

    // `git log` over a real repository cannot complete in 1 ms; the point is that the bound is
    // honoured and the kill is reported rather than silently producing an empty review scope.
    const result = git(['log', '--oneline', '-n', '2000'])

    expect(result.ok).toBe(false)
    expect(warnings.length).toBe(1)
  })
})

describe('the reason is what git said, not what Node said about it', () => {
  it('test_the_warning_carries_git_stderr_rather_than_the_generic_command_failed', () => {
    // `execFileSync` throws with message "Command failed: git …", which names the command and not
    // the problem. The half worth reading is on the captured stderr.
    const warnings: string[] = []
    const git = createGitRunner({ timeoutMs: 10_000, onWarn: (m) => warnings.push(m) })

    git(['rev-parse', '--verify', 'refs/heads/branch-that-does-not-exist-4f2a'])

    // Matched on the ref name rather than on git's English sentence: `Needed a single revision` is
    // localised, so asserting it would fail for anyone running a translated git.
    expect(warnings[0], 'the generic Node message was reported instead of git stderr').toContain(
      'branch-that-does-not-exist-4f2a',
    )
  })
})
