/**
 * How many attempts the current turn spent, read from the run's `rate_limit` events.
 *
 * `RunRateLimitEvent.attempt` is 1-based and supplied by the SDK, so this remembers the highest one seen
 * rather than counting events: a re-delivered event must not inflate the figure `describeTurnFailure` shows.
 */
export interface TurnRetries {
  /** Pass as `onRunEvent`; reads `rate_limit` events and ignores the rest. */
  readonly onRunEvent: (event: { type: string; attempt?: number }) => void
  /** Highest attempt seen since the last `startTurn`; `0` when the turn never retried. */
  attempts(): number
  /** Call when a turn begins: a stale count is a false attribution. */
  startTurn(): void
}

export function createTurnRetries(): TurnRetries {
  let highest = 0
  return {
    onRunEvent(event) {
      if (event.type !== 'rate_limit') return
      const attempt: unknown = event.attempt
      // The event crosses a package boundary: a non-integer would reach the user as "after NaN attempts".
      if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1) return
      if (attempt > highest) highest = attempt
    },
    attempts: () => highest,
    startTurn() {
      highest = 0
    },
  }
}
