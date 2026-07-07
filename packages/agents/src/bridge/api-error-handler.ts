/**
 * M19 (theokit-ai-first) — `processApiError`: app-level fallback around an agent run.
 *
 * ADR-0040 § D2 + sdk-runtime.md: the `@theokit/sdk` runtime OWNS the LLM call AND its own
 * retry/backoff, and exposes NO api-error hook to plugins. This module is therefore NOT a plugin —
 * it is a thin app-boundary wrapper (the M19 DoD explicitly allows "a sibling factory"). It
 * RE-INVOKES the caller's run thunk on error; it never calls an LLM, never dispatches a tool, never
 * reimplements retry inside the loop (G2). The SDK's internal retry runs first; this handles what
 * survives it — a second, app-owned fallback layer (the M19 top-risk note: "app-level fallback, not
 * a second retry loop" inside the SDK).
 */

/** What the app decides after seeing an API error. */
export interface ApiErrorDecision<R = unknown> {
  /** Re-invoke the run thunk once more. Ignored past `maxAttempts`. */
  retry?: boolean
  /**
   * A value to return INSTEAD of rethrowing, when `retry` is false/absent. Lets the app degrade
   * gracefully (e.g. a canned response) rather than surface the raw provider error.
   */
  fallback?: R
}

/** Context handed to the app's error handler for each failed attempt (1-based). */
export interface ApiErrorContext {
  error: unknown
  /** 1-based attempt number that just failed. */
  attempt: number
}

export interface ApiErrorPolicy<R = unknown> {
  /** Called once per failed attempt. Return `{ retry: true }` to try again, or a `{ fallback }`. */
  processApiError: (ctx: ApiErrorContext) => ApiErrorDecision<R> | Promise<ApiErrorDecision<R>>
  /**
   * Hard cap on total attempts (defaults to 3). A backstop so a handler that always returns
   * `{ retry: true }` cannot loop forever (mirrors the SDK's own bounded retry philosophy).
   */
  maxAttempts?: number
}

const DEFAULT_MAX_ATTEMPTS = 3

/**
 * Run `thunk`, applying the app's `processApiError` policy on failure. Returns the run's value on
 * success, the policy's `fallback` when it declines to retry with one, or rethrows the last error.
 *
 * `thunk` is typically `() => agent.send(msg).then((r) => r.wait())` — a whole SDK run. On retry the
 * thunk is re-invoked from scratch (a fresh run), never resumed mid-loop.
 */
export async function runWithApiErrorHandling<R>(
  thunk: () => Promise<R>,
  policy: ApiErrorPolicy<R>,
): Promise<R> {
  const maxAttempts = policy.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  let attempt = 0
  // Loop bounded by maxAttempts; each iteration is one full run attempt.
  for (;;) {
    attempt += 1
    try {
      return await thunk()
    } catch (error) {
      const decision = await policy.processApiError({ error, attempt })
      if (decision.retry && attempt < maxAttempts) continue
      if (!decision.retry && 'fallback' in decision && decision.fallback !== undefined) {
        return decision.fallback
      }
      throw error
    }
  }
}

/**
 * Build a reusable guard bound to one policy. `const guard = createApiErrorHandler({ ... })` then
 * `guard(() => agent.send(m).then((r) => r.wait()))` — the same policy applied to many runs.
 */
export function createApiErrorHandler<R = unknown>(
  policy: ApiErrorPolicy<R>,
): (thunk: () => Promise<R>) => Promise<R> {
  return (thunk) => runWithApiErrorHandling(thunk, policy)
}
