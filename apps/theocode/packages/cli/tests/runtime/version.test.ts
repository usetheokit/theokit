/**
 * #128 — `theocode --version` prints a version and exits 0.
 *
 * It used to be rejected as an unknown option, with a usage dump and exit 1. That is the wrong
 * shape twice over: it is the first thing anyone types against an unfamiliar binary, and "unknown
 * option + usage" reads as *you used the tool wrong* rather than *that flag does not exist here* —
 * an ambiguity the usage text already tries to explain for prompts beginning with `-`.
 *
 * It also left a bug reporter with no in-product way to name their build: `doctor` did not print one
 * either, so the answer to "which version are you on?" was to read a file.
 */
import { describe, expect, it } from 'vitest'

import { parseExecArgs } from '../../src/runtime/args.js'
import { USAGE } from '../../src/runtime/usage.js'

describe('--version', () => {
  it('test_it_is_its_own_mode_not_an_unknown_option', () => {
    expect(parseExecArgs(['--version'], false)).toMatchObject({ mode: 'version' })
  })

  it('test_the_short_form_works_too', () => {
    expect(parseExecArgs(['-v'], false)).toMatchObject({ mode: 'version' })
  })

  it('test_it_does_not_fall_through_to_a_billable_turn', () => {
    // The failure this replaces is worse than an error: a token beginning with `-` that the parser
    // does not know can land in the PROMPT, which starts a model turn. B-022 records exactly that
    // for `exec`.
    expect(parseExecArgs(['--version'], false).mode).not.toBe('run')
  })

  it('test_a_prompt_is_still_a_prompt', () => {
    // Anti-vacuity floor: a parser that routed everything away from `run` would satisfy the arm
    // above.
    expect(parseExecArgs(['what version are you'], false).mode).toBe('run')
  })

  it('test_the_usage_text_teaches_it', () => {
    // Undiscoverable otherwise, and this is the flag people look for in usage first.
    expect(USAGE).toContain('--version')
  })
})
