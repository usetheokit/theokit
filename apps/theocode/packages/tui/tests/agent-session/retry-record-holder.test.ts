/**
 * The TUI's holder for B-130, and the property that makes it worth having a holder at all: the count
 * belongs to ONE turn.
 *
 * Mirrors `mcp-failure-record.test.ts` — the mechanism is tested in `@theocode/shared`; what is
 * tested here is the lifetime decision this file makes.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  currentAttempts,
  resetRetryRecord,
  sinkRetryEvent,
  startRetryTurn,
} from '../../src/agent-session/retry-record-holder.js'

const rateLimit = (attempt: number): Parameters<typeof sinkRetryEvent>[0] =>
  ({ type: 'rate_limit', attempt }) as never

describe('the TUI retry holder', () => {
  beforeEach(() => {
    resetRetryRecord()
  })

  it('test_it_starts_empty', () => {
    expect(currentAttempts()).toBe(0)
  })

  it('test_it_records_what_the_provider_reached_during_the_turn', () => {
    sinkRetryEvent(rateLimit(1))
    sinkRetryEvent(rateLimit(2))

    expect(currentAttempts()).toBe(2)
  })

  it('test_a_new_turn_does_not_inherit_the_previous_turns_count', () => {
    // The reason this holder exists rather than a module-level number: reporting "after 3 attempts"
    // on a turn that made one is a number that is WRONG, which is worse than one that is absent.
    sinkRetryEvent(rateLimit(3))
    startRetryTurn()

    expect(currentAttempts()).toBe(0)
  })

  it('test_the_sink_follows_the_holder_across_a_reset', () => {
    // Anti-vacuity for the note in the module: exporting `record.sink` directly would capture the
    // instance at module evaluation, so after a reset the sink would write where nobody reads.
    sinkRetryEvent(rateLimit(2))
    resetRetryRecord()
    sinkRetryEvent(rateLimit(1))

    expect(currentAttempts()).toBe(1)
  })
})
