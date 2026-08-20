import { describe, it, expect } from 'vitest'
import type { IncomingMessage } from 'node:http'

import {
  extractTraceId,
  extractTraceIdFromRequest,
} from '../../packages/theo/src/server/http/trace-context.js'

/**
 * usetheokit/theokit#353 - the trace id is derived from headers a client controls,
 * and it flows into the structured logs an operator reads.
 *
 * Tier 1 (`traceparent`) was validated properly already: 32 hex, 16 hex, and the
 * reserved all-zeros rejected, per W3C. Tier 2 (`x-request-id`) was accepted
 * verbatim - any length, any bytes. A newline in it splits one log line into two,
 * the second forged; a megabyte of it is a megabyte per request in the log
 * pipeline; and either way the caller, not the server, chooses the identifier
 * every later diagnostic keys on.
 *
 * Rejecting falls through to a generated id rather than to an error. A malformed
 * correlation header is not a reason to refuse the request - it is a reason not to
 * trust the value.
 *
 * The hostile values are BUILT from char codes rather than written as escapes, so
 * the assertion cannot be weakened by an editor or a tool normalising them away.
 */

const NEWLINE = String.fromCharCode(10)
const TAB = String.fromCharCode(9)
const ESCAPE = String.fromCharCode(27)

function nodeRequest(headers: Record<string, string | string[]>): IncomingMessage {
  return { headers } as unknown as IncomingMessage
}

const GENERATED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('the trace id never trusts an unvalidated header (#353)', () => {
  it('test_a_well_formed_request_id_is_still_honoured', () => {
    const id = extractTraceId(nodeRequest({ 'x-request-id': '01JD9Z2K7Q-abc.def:1' }))

    expect(id).toBe('01JD9Z2K7Q-abc.def:1')
  })

  it('test_a_traceparent_still_wins_over_a_request_id', () => {
    const id = extractTraceId(
      nodeRequest({
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        'x-request-id': 'ignored',
      }),
    )

    expect(id).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  it('test_a_newline_in_the_request_id_is_refused_not_logged', () => {
    const forged = 'ok' + NEWLINE + 'forged-log-line'

    const id = extractTraceId(nodeRequest({ 'x-request-id': forged }))

    expect(id).not.toContain(NEWLINE)
    expect(id).toMatch(GENERATED)
  })

  it('test_an_oversized_request_id_is_refused', () => {
    const id = extractTraceId(nodeRequest({ 'x-request-id': 'a'.repeat(4096) }))

    expect(id).toMatch(GENERATED)
  })

  it('test_control_characters_and_spaces_are_refused', () => {
    const hostile = ['has space', 'tab' + TAB + 'here', ESCAPE + '[31m']

    for (const bad of hostile) {
      expect(extractTraceId(nodeRequest({ 'x-request-id': bad }))).toMatch(GENERATED)
    }
  })

  it('test_an_empty_or_absent_request_id_generates_one', () => {
    expect(extractTraceId(nodeRequest({}))).toMatch(GENERATED)
    expect(extractTraceId(nodeRequest({ 'x-request-id': '' }))).toMatch(GENERATED)
  })

  it('test_the_web_shaped_resolver_applies_the_same_rule', () => {
    // Two resolvers, one policy. A validation living on one side only is the gap
    // an attacker picks the other transport to reach.
    const request = new Request('http://localhost/a', {
      headers: { 'x-request-id': 'has space' },
    })

    expect(extractTraceIdFromRequest(request)).toMatch(GENERATED)
  })

  it('test_a_multi_valued_request_id_takes_the_first_VALID_value', () => {
    // `pickHeader` took the first non-empty value and handed it on unchecked, so a
    // proxy prepending a bad value used to defeat a good one behind it.
    const id = extractTraceId(nodeRequest({ 'x-request-id': ['has space', 'good-value-1'] }))

    expect(id).toBe('good-value-1')
  })
})
