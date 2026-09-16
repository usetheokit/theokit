/**
 * The configured shell timeout reaches the subprocess that actually runs the operator's command.
 *
 * `shell_timeout_ms` existing in the schema proves nothing on its own — a key that resolves and is
 * then ignored at the call site is the same defect as no key, with more documentation. This is the
 * integration test at the boundary: a real `execFile`, a real child process, a real kill.
 *
 * It is deliberately NOT a unit test with a mocked `execFile`. Mocking the thing under test here
 * would assert that we pass a number to a function, which is not the claim; the claim is that a
 * command exceeding the bound is killed and one inside it is not.
 */
import { describe, expect, it } from 'vitest'

import { expansionDeps } from '../../src/commands/config-commands.js'

const noop = (): void => {}

/** The bound under test, named once so the ceiling below can be stated as a multiple of it. */
const BOUND_MS = 120

/**
 * How long the killed command runs when the bound never reaches `execFile`.
 *
 * Ten seconds rather than five, because the ceiling and the command used to sit a factor of 2.5
 * apart — 2 000 ms against a 5 s `sleep` — and this runner is documented as inflating a 700 ms test
 * to 5 100 ms under full-suite parallelism (`vitest.config.ts`). A budget that close to the thing it
 * races is decided by scheduling, not by the feature. Ten seconds also stays under the 20 s
 * `testTimeout`, so a regression fails on the assertion below, which names what went wrong, rather
 * than on a runner timeout, which does not.
 */
const UNBOUNDED = 'sleep 10 && echo finished'

describe('shell_timeout_ms bounds the operator command', () => {
  it('test_a_command_that_outruns_the_configured_timeout_is_killed', async () => {
    const started = Date.now()
    const result = await expansionDeps(noop, BOUND_MS).shell(UNBOUNDED)

    expect(result.ok, 'a command past the bound reported success').toBe(false)
    // `ok: false` alone does not say the command was CUT OFF — a shell that failed instantly for
    // some other reason reports the same thing. The word the command prints on its last line is the
    // direct evidence: it is absent exactly when the process did not live long enough to print it.
    expect(result.text, 'the command ran to completion and still reported failure').not.toContain(
      'finished',
    )
    // The clock stays as a coarse net for the one thing the two assertions above cannot see: a bound
    // enforced by something other than `execFile`'s own timer. Twenty-five times the bound leaves a
    // killed-at-120 ms command roughly twenty times its real duration of headroom, and still sits an
    // order of magnitude below the 10 s the command would take unbounded.
    expect(Date.now() - started, 'nothing killed the command near its configured bound').toBeLessThan(
      BOUND_MS * 25,
    )
  })

  it('test_a_command_inside_the_configured_timeout_survives', async () => {
    // Anti-vacuity floor: returning ok:false unconditionally would satisfy the test above.
    const result = await expansionDeps(noop, 10_000).shell('echo alive')

    expect(result.ok).toBe(true)
    expect(result.text.trim()).toBe('alive')
  })

  it('test_raising_the_bound_is_what_changes_the_outcome', async () => {
    // The finding, expressed as a test: the SAME command that dies under a short bound survives
    // under a longer one. Before this key the operator could not reach either side of this line.
    const short = await expansionDeps(noop, 120).shell('sleep 0.6')
    const long = await expansionDeps(noop, 5_000).shell('sleep 0.6')

    expect(short.ok).toBe(false)
    expect(long.ok).toBe(true)
  })
})
