/**
 * Mapping from an SDK error → the stream's error event.
 *
 * Its own module for the same reason as `model-selection.ts`: it is a pure mapper, and
 * `sdk-adapter.ts` sits under a 500-line ceiling. Having its own home also makes it obvious that
 * **one** place builds the error event — before there was an object literal inside a `catch`, and
 * that is where the information died.
 */
/**
 * Converts an SDK error into the stream's error event, **preserving the `code`**.
 *
 * Its own exported function because this was the point where the information died: the `catch`
 * pinned `code: 'SDK_ERROR'` and `retryable: false` for every error, and whoever consumed the stream
 * was left with only the message text to tell one failure from another — the heuristic this
 * ecosystem has already paid for (M93 classified transience by regex over the message and treated
 * `ECONNREFUSED …:443` as final, because the PORT matched the "4xx" pattern).
 *
 * Exported so the test exercises **this** function, and not a hand-assembled input fed into the next
 * stage of the pipeline. Three tests in this milestone fell into that trap: they constructed the
 * unit's input instead of exercising what produces it, and so missed the flattening here.
 *
 * @internal
 */
export function sdkErrorEvent(err: unknown): {
  type: 'error'
  code: string
  message: string
  retryable: boolean
} {
  const sdkErr = err as { code?: string; isRetryable?: boolean }
  return {
    type: 'error',
    code: sdkErr.code ?? 'SDK_ERROR',
    message: err instanceof Error ? err.message : 'SDK agent error',
    // The SDK computes `isRetryable` per error class at construction; pinning it to `false` here
    // contradicted the error itself.
    retryable: sdkErr.isRetryable === true,
  }
}
