/**
 * Every failed turn in this product used to read `An error occurred.`
 *
 * Measured 2026-08-25 — `theocode run "reply PONG"`, before this module existed:
 *
 *     ERROR: An error occurred.
 *     [exec] session=exec-… status=error tokens=0
 *
 * and with `THEOCODE_DIAGNOSTICS=stderr`, an environment variable the message does not mention:
 *
 *     retry 1/3 in 20ms — RateLimitError
 *     retry 2/3 in 403ms — RateLimitError
 *
 * After: `ERROR: openai API error: rate_limit (HTTP 429) [AGENT_ERROR] — the provider is
 * rate-limiting this account — wait and retry, or switch model with /model`.
 */
import { describe, expect, it } from 'vitest'

import { turnErrorText } from '../src/turn-error.js'

describe('turnErrorText', () => {
  it('test_the_underlying_message_survives', () => {
    // The whole defect: the framework's default discards it and the user is left with nothing to
    // search, quote in an issue, or act on.
    expect(turnErrorText({ message: 'openai API error: rate_limit (HTTP 429)' })).toContain(
      'rate_limit',
    )
  })

  it('test_the_code_is_shown_when_the_framework_supplies_one', () => {
    expect(turnErrorText({ message: 'boom', code: 'AGENT_ERROR' })).toContain('[AGENT_ERROR]')
  })

  it('test_an_unrecognised_failure_is_still_reported_verbatim', () => {
    // A hint is a bonus. A failure with no hint must still say what happened — falling back to a
    // fixed string for the unknown cases would reinstate the defect for exactly the failures
    // nobody anticipated.
    const text = turnErrorText({ message: 'the tool registry disagreed with itself' })

    expect(text).toBe('the tool registry disagreed with itself')
  })

  it('test_an_empty_message_never_renders_as_nothing', () => {
    // A blank line where the reason belongs is the same defect as the fixed string: the user learns
    // nothing, and now nothing even looks wrong.
    expect(turnErrorText({ message: '   ' })).toBe('the turn failed with no message')
    expect(turnErrorText({ message: '' })).not.toBe('')
  })
})

describe('the hints point at the next step, not at the diagnosis', () => {
  const hint = (message: string, code?: string): string =>
    turnErrorText(code === undefined ? { message } : { message, code })

  it('test_a_rate_limit_says_what_to_do_about_it', () => {
    expect(hint('openai API error: rate_limit (HTTP 429)')).toContain('/model')
  })

  it('test_a_refused_credential_points_at_login', () => {
    expect(hint('AuthenticationError: invalid_api_key')).toContain('/login')
  })

  it('test_an_unreachable_provider_is_not_confused_with_a_refused_credential', () => {
    // Different remedies: one is "log in again", the other is "check your network". Collapsing
    // them sends the user to re-authenticate a credential that was never the problem.
    const network = hint('connect ECONNREFUSED 10.0.0.1:443')

    expect(network).toContain('network')
    expect(network).not.toContain('/login')
  })

  it('test_an_outgrown_context_window_points_at_compact', () => {
    expect(hint('context length exceeded')).toContain('/compact')
  })

  it('test_the_hint_is_matched_on_the_code_too_not_only_the_message', () => {
    // The framework supplies a code where it has one, and a code is stable in a way a message
    // reworded upstream is not.
    expect(hint('request failed', 'rate_limit_exceeded')).toContain('rate-limiting')
  })
})

/**
 * What the failure says about the retries it spent, and about how to see more.
 *
 * Two findings from the 2026-09-03 system-design sweep meet here, because they are the same surface:
 *
 *   B-130 — the transport retried three times and the product never said so, so a 401 that surfaced
 *           as a 429 read as a quota problem.
 *   B-129 — `THEOCODE_DIAGNOSTICS` is the only way to see the retry sequence, and the failure text
 *           did not mention it. `turn-error.ts:13` said so about itself.
 *
 * Both are additions to the text and neither replaces the message or the hint: a failure must still
 * say what happened first.
 */
describe('the failure accounts for the attempts it spent', () => {
  it('test_a_turn_that_retried_says_how_many_attempts_were_spent', () => {
    const text = turnErrorText(
      { message: 'openai API error: rate_limit (HTTP 429)' },
      { attempts: 3 },
    )

    expect(text).toContain('3 attempts')
  })

  it('test_a_turn_that_never_retried_says_nothing_about_attempts', () => {
    // The count is only interesting when retrying happened. "after 0 attempts" on every ordinary
    // failure is the noise that gets a message ignored.
    const text = turnErrorText({ message: 'boom' }, { attempts: 0 })

    expect(text).not.toContain('attempt')
  })

  it('test_one_attempt_is_not_reported_as_a_retry', () => {
    // A single attempt IS the turn. Calling it a retry would be false.
    expect(turnErrorText({ message: 'boom' }, { attempts: 1 })).not.toContain('attempt')
  })

  it('test_the_message_and_the_hint_still_come_first', () => {
    // The attempt count is context, not the headline. Regression guard on the original defect.
    const text = turnErrorText(
      { message: 'openai API error: rate_limit (HTTP 429)' },
      { attempts: 3 },
    )

    expect(text.indexOf('rate_limit')).toBeLessThan(text.indexOf('3 attempts'))
    expect(text).toContain('/model')
  })
})

describe('the failure names the switch that shows more', () => {
  it('test_it_names_the_diagnostics_variable_when_diagnostics_are_off', () => {
    // The finding, verbatim from the module's own docblock: the variable is "an environment variable
    // the failure message does not mention".
    const text = turnErrorText({ message: 'boom' }, { diagnosticsEnabled: false })

    expect(text).toContain('THEOCODE_DIAGNOSTICS')
  })

  it('test_it_stays_quiet_when_diagnostics_are_already_on', () => {
    // Telling an operator to turn on what they already turned on is the noise this hint has to
    // avoid to remain worth reading.
    const text = turnErrorText({ message: 'boom' }, { diagnosticsEnabled: true })

    expect(text).not.toContain('THEOCODE_DIAGNOSTICS')
  })

  it('test_it_stays_quiet_when_the_surface_did_not_say_either_way', () => {
    // Absent context must not be read as "off". A surface that has not been wired yet should keep
    // the old text rather than advertise a variable whose state nobody checked.
    expect(turnErrorText({ message: 'boom' })).not.toContain('THEOCODE_DIAGNOSTICS')
    expect(turnErrorText({ message: 'boom' }, {})).not.toContain('THEOCODE_DIAGNOSTICS')
  })

  it('test_both_additions_can_appear_together_without_losing_the_message', () => {
    const text = turnErrorText(
      { message: 'openai API error: rate_limit (HTTP 429)', code: 'AGENT_ERROR' },
      { attempts: 3, diagnosticsEnabled: false },
    )

    expect(text).toContain('rate_limit')
    expect(text).toContain('[AGENT_ERROR]')
    expect(text).toContain('3 attempts')
    expect(text).toContain('THEOCODE_DIAGNOSTICS')
  })
})

/**
 * The SDK's TYPED error codes must reach the hints, and ten of eleven did not.
 *
 * The table was written against provider MESSAGE text — `401`, `unauthor`, `econnrefused`,
 * `context`+`length` — so it fires when the raw message happens to contain those strings and stays
 * silent on the typed path. Measured 2026-09-04 against `ErrorCode` in `@theokit/sdk@4.63.4-next.0`:
 * only `rate_limit` matched, and only because the code string coincides with a text pattern.
 *
 * The case that matters is `auth_failed`, which is what a refused credential reports today. B-149
 * was filed because a 401 reached the user as a rate-limit; upstream fixed the class (the 429 retry
 * fires only on a real 429, and `auth_failed` is a distinct code), and this is the half that stayed
 * broken on OUR side — the class arrives correctly and we say nothing about it.
 */
describe('the SDK typed error codes reach a hint', () => {
  /**
   * The HINT only — everything after the em dash.
   *
   * Asserting on the whole string passes for the wrong reason: the code is echoed in the label
   * (`… [network]`), so `toContain('network')` is satisfied by the label whether or not a hint
   * exists. Two assertions in the first draft of this block were green for exactly that reason.
   */
  const hintFor = (code: string) => {
    const out = turnErrorText({ code, message: 'the provider refused' }, {})
    const at = out.indexOf(' — ')
    return at === -1 ? '' : out.slice(at + 3)
  }

  it('test_auth_failed_points_at_the_credential', () => {
    // The B-149 case. Before this, `auth_failed` produced the bare message and no next step, while a
    // raw "401" in the text produced the hint — the typed path was the one left with nothing.
    expect(hintFor('auth_failed')).toContain('/login')
  })

  it('test_context_too_long_points_at_compact', () => {
    expect(hintFor('context_too_long')).toContain('/compact')
  })

  it.each(['network', 'timeout'])('test_%s_points_at_the_connection', (code) => {
    expect(hintFor(code)).toContain('network')
  })

  it('test_quota_exceeded_is_not_reported_as_rate_limiting', () => {
    // Distinct actions: rate limiting clears by waiting, an exhausted quota does not. Collapsing
    // them would send the user to wait out a condition that never resolves.
    const quota = hintFor('quota_exceeded')

    expect(quota).not.toContain('wait and retry')
    expect(quota).toContain('quota')
  })

  it('test_model_unavailable_points_at_the_model_switch', () => {
    expect(hintFor('model_unavailable')).toContain('/model')
  })

  it('test_a_code_with_no_honest_action_gets_no_hint', () => {
    // Anti-vacuity, and the honest half: `unknown` means the SDK could not classify it, and inventing
    // a next step for it would be a guess dressed as guidance.
    expect(hintFor('unknown')).toBe('')
  })

  it('test_the_message_patterns_still_work_for_a_provider_that_sets_no_code', () => {
    // The text table is not replaced. A provider that returns a bare string keeps its hint.
    expect(turnErrorText({ message: '401 Unauthorized' }, {})).toContain('/login')
  })
})

describe('a tool result the provider cannot carry', () => {
  it('test_the_failure_says_a_tool_returned_the_image', () => {
    // Measured 2026-09-07, and it cost two sessions hours. A turn failed with
    // `provider "openai-responses" does not support image content in tool results` right after the
    // user attached an image with /image, and the natural reading — "my attachment is unsupported" —
    // is wrong: the guard is reachable ONLY from a `tool_result` part, so a TOOL returned the image.
    // The attachment itself takes the `input_image` branch and never reaches it.
    const said = turnErrorText({
      message: 'provider "openai-responses" does not support image content in tool results',
    })

    expect(said).toContain('a tool returned an image')
  })

  it('test_it_points_at_the_key_that_reveals_which_tool_ran', () => {
    // The other half of why this was invisible: the transcript collapses tool activity to
    // `Used 1 tool` unless ctrl+o is pressed, so the run that failed looked identical to the ones
    // that passed. One keystroke away, and nothing said so.
    const said = turnErrorText({
      message: 'provider "openai-responses" does not support image content in tool results',
    })

    expect(said).toContain('ctrl+o')
  })

  it('test_an_unrelated_image_failure_does_not_claim_a_tool_ran', () => {
    // Anti-vacuity floor, and the honesty floor: the claim "a tool returned an image" is only true
    // for THIS error, whose guard sits behind a tool_result part. A message that merely mentions an
    // image must not inherit it.
    const said = turnErrorText({ message: 'the image file could not be read' })

    expect(said).not.toContain('a tool returned an image')
  })
})
