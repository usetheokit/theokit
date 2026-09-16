/**
 * How many attempts a turn spent before it failed, counted from the SDK's own event.
 *
 * The retry policy on the critical path belongs to the transport: three attempts with a growing
 * delay, measured 2026-08-25 as `retry 1/3 in 20ms` then `retry 2/3 in 403ms`. Nothing in this
 * product declared it, configured it, or SAW it — and that last one is what cost a user a trip to a
 * quota page. `packages/cli/src/commands/run.ts:56` records the case: after those retries an auth
 * failure surfaced as `rate_limit (HTTP 429)`, "which reads as a quota problem".
 *
 * The count is not invented here. `RunRateLimitEvent` carries a 1-based `attempt` and an optional
 * `retryAfterMs`, delivered on the same `onRunEvent` stream the MCP sink already consumes. This
 * module does one thing with it: remember the highest attempt seen in the current turn.
 */
import { describe, expect, it } from 'vitest'

import { createRetryRecord } from '../src/retry-record.js'

const rateLimit = (
  attempt: number,
  retryAfterMs?: number,
): Parameters<ReturnType<typeof createRetryRecord>['sink']>[0] =>
  ({
    type: 'rate_limit',
    attempt,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  }) as never

describe('createRetryRecord', () => {
  it('test_a_turn_that_never_retried_reports_no_attempts', () => {
    // The common case. Reporting "after 1 attempt" on every clean failure would be noise on the
    // failures that have nothing to do with retrying.
    expect(createRetryRecord().attempts()).toBe(0)
  })

  it('test_it_reports_the_highest_attempt_the_provider_reached', () => {
    const record = createRetryRecord()

    record.sink(rateLimit(1))
    record.sink(rateLimit(2))

    expect(record.attempts()).toBe(2)
  })

  it('test_it_is_not_a_count_of_events', () => {
    // Anti-vacuity, and a real hazard: a duplicated or re-delivered event must not inflate the
    // number the user is shown. The attempt number is the provider's, not ours to accumulate.
    const record = createRetryRecord()

    record.sink(rateLimit(1))
    record.sink(rateLimit(1))
    record.sink(rateLimit(2))
    record.sink(rateLimit(2))

    expect(record.attempts()).toBe(2)
  })

  it('test_every_other_run_event_is_ignored', () => {
    // The MCP sink shares this stream and reads exactly one member of the union. This one reads a
    // different member; anything else must leave the count alone.
    const record = createRetryRecord()

    record.sink({ type: 'tool_progress', toolName: 'read_file', toolCallId: 'x' } as never)
    record.sink({ type: 'mcp_server_failed', serverName: 'db', message: 'boom' } as never)

    expect(record.attempts()).toBe(0)
  })

  it('test_a_new_turn_starts_from_zero', () => {
    // Without this, the count from a failed turn would be reported on the next one, which is worse
    // than not reporting it: it would be a number that is wrong rather than absent.
    const record = createRetryRecord()
    record.sink(rateLimit(3))

    record.startTurn()

    expect(record.attempts()).toBe(0)
  })

  it('test_a_malformed_attempt_is_ignored_rather_than_rendered', () => {
    // The event crosses a package boundary. A non-integer attempt would otherwise reach the user as
    // "after NaN attempts", which is worse than saying nothing.
    const record = createRetryRecord()

    record.sink({ type: 'rate_limit', attempt: Number.NaN } as never)
    record.sink({ type: 'rate_limit' } as never)
    record.sink({ type: 'rate_limit', attempt: -2 } as never)

    expect(record.attempts()).toBe(0)
  })
})
