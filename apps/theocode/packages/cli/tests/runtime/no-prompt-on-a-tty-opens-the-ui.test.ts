/**
 * `theocode` with no prompt, on a terminal, opens the UI instead of refusing.
 *
 * ## What it did before
 *
 * `resolveInput` answered `{ error: 'No prompt provided' }` whenever the prompt was absent and
 * stdin was a TTY — so running the installed binary with no arguments printed a usage error and
 * exited 1. The terminal UI existed and was reachable only through `npm run dev`, which means it
 * was reachable only from a checkout of this repository.
 *
 * Measured 2026-09-17 while setting up a side-by-side comparison against Claude Code: `claude`
 * with no arguments opens its session; `theocode` with no arguments exits. All 46 slash commands
 * live in the UI, `/login` among them — so the OAuth device flow, the documented way to
 * authenticate, could not be reached from an install at all.
 *
 * ## Why the TTY is the condition, and not a flag
 *
 * A pipe with no prompt is still `stdinBehavior: 'required'` — reading the prompt from stdin is a
 * real use and must keep working. The UI needs a terminal to draw on, so "no prompt AND a
 * terminal" is exactly the case where opening it is the only sensible answer. Anything else keeps
 * the behaviour it had.
 */
import { describe, expect, it } from 'vitest'

import { parseExecArgs } from '../../src/runtime/args.js'

describe('no prompt on a terminal', () => {
  it('test_bare_invocation_on_a_tty_asks_for_the_ui', () => {
    expect(parseExecArgs([], true)).toEqual({ mode: 'ui' })
  })

  it('test_a_pipe_with_no_prompt_still_reads_stdin', () => {
    // The control that keeps this from becoming a regression: `theocode < file` and
    // `echo x | theocode` must go on working, and neither has a terminal to draw a UI on.
    expect(parseExecArgs([], false)).toMatchObject({ mode: 'run', stdinBehavior: 'required' })
  })

  it('test_a_prompt_on_a_tty_is_still_one_shot', () => {
    // The other control. A prompt means the user asked for an answer, not a session.
    expect(parseExecArgs(['hello'], true)).toMatchObject({ mode: 'run', prompt: 'hello' })
  })

  it('test_flags_that_mean_something_else_are_untouched', () => {
    expect(parseExecArgs(['--version'], true)).toEqual({ mode: 'version' })
    expect(parseExecArgs(['doctor'], true)).toMatchObject({ mode: 'doctor' })
  })
})
