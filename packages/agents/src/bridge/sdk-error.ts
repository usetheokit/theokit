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
  /**
   * The thrown Error's stack, for the SERVER only.
   *
   * B-323 — this function is the only place the Error OBJECT is still alive; everything downstream
   * sees the flattened event. Dropping `stack` destroyed the one thing that names WHERE a turn
   * failed, and the operator was left with a message. Measured 2026-09-28, with the masked message
   * finally reachable (B-322): `[unenv] fs.readFile is not implemented yet!` — a Node builtin
   * refusing on Workers, with six plausible call sites in the SDK. Without a stack the next step is
   * guessing which, and a guess costs a deploy per candidate.
   *
   * It never reaches the wire. A stack names files, directories and sometimes an argument, which is
   * exactly what `MASK_ERROR` exists to keep from a browser — and `errorChunks` constructs each
   * chunk explicitly rather than spreading the event, so that is structural and not a habit.
   */
  stack?: string
} {
  const sdkErr = err as { code?: string; isRetryable?: boolean }
  return {
    type: 'error',
    code: sdkErr.code ?? 'SDK_ERROR',
    message: err instanceof Error ? err.message : 'SDK agent error',
    // The SDK computes `isRetryable` per error class at construction; pinning it to `false` here
    // contradicted the error itself.
    retryable: sdkErr.isRetryable === true,
    // Spread rather than `stack: …`, so a non-Error carries no key at all. `stack: undefined` reads
    // as the string "undefined" through a template, which a log would then print as if it meant
    // something.
    ...(err instanceof Error && err.stack !== undefined ? { stack: err.stack } : {}),
  }
}
