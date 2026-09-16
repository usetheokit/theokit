/**
 * B-018 — the turn-error classifier decides what the user is told to do next.
 *
 * `/retry` is offered for a transient failure and withheld for a fatal one, because retrying a
 * revoked credential or a malformed request wastes a turn and teaches the user the hint is noise.
 * This file was touched during the B-001..B-017 remediation and never had a test written against
 * it — one of the entries the TDD gate has been listing underneath a BLOCK, which is precisely how
 * an advisory goes unread.
 */
import { TheokitAgentError } from '@theokit/agents'
import { describe, expect, it } from 'vitest'

import { formatTurnError } from '../../src/formatting/turn-error.js'

/**
 * The retry hint is the observable difference between the two classifications, so the tests assert
 * on it rather than reaching for the internal view. `classifyTurnError` is not exported (B-049):
 * exporting a predicate purely to test it adds public surface this codebase is shrinking, and the
 * rendered string is what the user actually sees.
 */
const offersRetry = (err: Error): boolean => /\/retry/.test(formatTurnError(err))

describe('B-018 — a transient failure offers the retry, a fatal one does not', () => {
  it('test_a_network_reset_is_transient_and_offers_retry', () => {
    expect(
      offersRetry(new Error('socket hang up')),
      'a recoverable failure did not tell the user how to recover',
    ).toBe(true)
  })

  it('test_a_rate_limit_is_transient', () => {
    expect(offersRetry(new Error('HTTP 429 Too Many Requests'))).toBe(true)
  })

  it('test_a_transient_cause_nested_behind_a_generic_message_is_found', () => {
    // The error the user's provider actually raised is often wrapped. Classifying only the outer
    // message would call every wrapped timeout fatal.
    const wrapped = new Error('request failed', { cause: new Error('ETIMEDOUT') })

    expect(offersRetry(wrapped)).toBe(true)
  })

  it('test_a_typed_agent_error_is_fatal_and_offers_no_retry', () => {
    // Anti-vacuity floor: classifying everything transient would satisfy the assertions above, and
    // would put a useless hint under every failure.
    expect(
      offersRetry(new TheokitAgentError('credential revoked', { isRetryable: false })),
      'a fatal error offered a retry that cannot help',
    ).toBe(false)
  })

  it('test_an_empty_message_still_produces_something_readable', () => {
    expect(formatTurnError(new Error('')).length).toBeGreaterThan(0)
  })
})
