/**
 * The two seams `commands/run.ts` builds around a turn, and the silences both had.
 *
 * #29 — `createGitRunner` made `onWarn` REQUIRED, and said why: "making the callback mandatory
 * means a future caller cannot rebuild the silence by omitting an optional argument." This call
 * site rebuilt it by SUPPLYING one — `onWarn: () => {}`. The end-of-turn diff is what it backs, and
 * `turn-diff.ts` renders a failure as "the changes to N file(s) could not be shown: " followed by a
 * detail that git puts on stderr, so the sentence ended on a colon and nothing else.
 *
 * #30 — `turnFailureReporting` bundles three members precisely so that none can be forgotten:
 * "bundling them removes the way to wire one and forget the other, which is the only failure mode
 * the separate pieces cannot detect." The sole production consumer wired two. `startTurn` had a
 * test and no caller, and `session-busy.ts` opens a SECOND stream on the same hooks when the
 * session is contended — so a `rate_limit` counted in the first pass was still being attributed to
 * the second turn's error text, which is the false attribution the field's own doc names.
 */
import { describe, expect, it } from 'vitest'

import { turnFailureReporting } from '@theocode/shared/turn-failure-reporting'

import { createDiffGit, perTurnStream } from '../../src/commands/run.js'

const ABSENT_REF = ['rev-parse', '--verify', 'refs/heads/branch-that-does-not-exist-4f2a']

describe('#29 — the diff runner reports why git refused', () => {
  it('test_the_reason_a_diff_git_call_failed_reaches_the_operator', () => {
    const lines: string[] = []
    const git = createDiffGit(10_000, (line) => lines.push(line))

    const result = git(ABSENT_REF)

    expect(result.ok, 'the {ok, stdout} contract callers branch on changed').toBe(false)
    expect(lines.join('\n'), 'the reason was discarded at the call site').toContain('git')
  })

  it('test_a_call_that_succeeds_says_nothing', () => {
    // Anti-vacuity floor: warning unconditionally would satisfy the case above and would print a
    // line on every turn that changed a file.
    const lines: string[] = []
    const git = createDiffGit(10_000, (line) => lines.push(line))

    expect(git(['--version']).ok).toBe(true)
    expect(lines).toEqual([])
  })
})

describe('#30 — a retry count belongs to the turn that spent it', () => {
  const empty = (): AsyncIterable<unknown> =>
    (async function* () {
      // Nothing to yield: this test is about what happens at OPEN, not about the stream.
    })()

  it('test_a_count_from_the_first_stream_does_not_reach_the_second_turns_error', () => {
    const failure = turnFailureReporting({ diagnosticsEnabled: () => false })
    const open = perTurnStream(failure, empty)

    open('exec-1')
    failure.onRunEvent({ type: 'rate_limit', attempt: 3 })
    expect(failure.onError({ message: 'boom' }), 'the count never reached the first turn').toContain(
      'after 3 attempts',
    )

    // What `consumeWithForkIfBusy` does when the session is contended: a second stream, same hooks.
    open('exec-1-fork-abcd1234')

    expect(
      failure.onError({ message: 'boom' }),
      'the first pass’s attempts were attributed to a turn that never retried',
    ).not.toContain('attempts')
  })

  it('test_the_stream_the_caller_asked_for_is_the_one_returned', () => {
    // Anti-vacuity floor: a wrapper that reset the count and returned something else would pass the
    // case above while breaking every turn.
    const failure = turnFailureReporting({ diagnosticsEnabled: () => false })
    const seen: string[] = []
    const open = perTurnStream(failure, (sessionId) => {
      seen.push(sessionId)
      return empty()
    })

    open('exec-7')

    expect(seen).toEqual(['exec-7'])
  })
})
