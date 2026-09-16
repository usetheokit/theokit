import { createRetryRecord, type RateLimitLike } from './retry-record.js'
import { turnErrorText } from './turn-error.js'

/**
 * The two stream hooks that make a failed turn explain itself, wired to each other.
 *
 * They were two arguments to the same options object in `commands/run.ts`, a hundred lines into a
 * file at 9.8% coverage, and their LINKAGE was what carried B-130: the retry count only reaches the
 * user if `sink` is fed by the stream and `attempts()` is read when the error arrives. Dropping
 * either one leaves every unit test green — `createRetryRecord` and `turnErrorText` are both at 100%
 * — while the count silently stops appearing.
 *
 * Bundling them removes the way to wire one and forget the other, which is the only failure mode
 * the separate pieces cannot detect.
 */
export interface TurnFailureHooks {
  /** Feed the stream's run events. Anything that is not `rate_limit` is ignored. */
  readonly onRunEvent: (event: RateLimitLike) => void
  /** The text a failed turn shows the operator, carrying the retry count and the diagnostics hint. */
  readonly onError: (error: { message: string; code?: string }) => string
  /** Call when a turn begins: a count carried over from the previous turn is a false attribution. */
  readonly startTurn: () => void
}

export function turnFailureReporting(opts: {
  /**
   * Read at FAILURE time, not at construction.
   *
   * The hooks are installed before the turn starts; capturing a boolean here would report whether
   * diagnostics were on at wiring time, which is a different question from the one the message
   * answers.
   */
  readonly diagnosticsEnabled: () => boolean
}): TurnFailureHooks {
  const retries = createRetryRecord()
  return {
    onRunEvent: retries.sink,
    startTurn: retries.startTurn,
    onError: (error) =>
      turnErrorText(error, {
        attempts: retries.attempts(),
        diagnosticsEnabled: opts.diagnosticsEnabled(),
      }),
  }
}
