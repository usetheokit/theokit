import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * M81 — the two gaps around a delegation's LIFE, as opposed to its execution.
 *
 * The execution engine was supplied and works. What was missing sits either side of it:
 *
 * - **a clock cap.** `budget` is money only, and a delegation that HANGS burns clock, not dollars.
 *   So a consumer wrote its own timeout race with its own typed error — mechanism, re-derived.
 * - **disposal with an owner.** `delegate()` never creates disposable agents, so every site that
 *   does — a squad, an ephemeral reviewer — hand-wrote acquire/dispose. Both of those files carried
 *   a bug-fix comment about `finally` semantics, which is what "we got this wrong once" looks like
 *   when the correct version lives nowhere in particular.
 */

/**
 * Raised when a delegation exceeds its wall-clock cap.
 *
 * A distinct class from the budget error on purpose: "you spent your dollars" and "you ran out of
 * time" call for different responses, and a caller that cannot tell them apart retries the one that
 * will hang again.
 */
export class DelegationTimeoutError extends TheokitAgentError {
  override readonly name = 'DelegationTimeoutError'
  constructor(subAgent: string, timeoutMs: number) {
    super(
      `delegation to "${subAgent}" exceeded its ${String(timeoutMs)} ms clock cap. This is a WALL ` +
        `CLOCK limit, not a budget: the run may have been progressing and simply slow, or hung. ` +
        `Raise \`timeoutMs\` if the work legitimately takes longer.`,
      {
        code: 'DELEGATION_TIMEOUT',
        // A hang is often transient — the model, a tool or a network call. Unlike the budget errors,
        // this one is worth another attempt, which is exactly why it is a separate class.
        isRetryable: true,
      },
    )
  }
}

/**
 * Race a delegation against a wall clock.
 *
 * The timer is cleared on both paths: a pending `setTimeout` keeps the event loop alive, and a CLI
 * that finishes its work and then sits for thirty seconds looks broken in a way nobody connects back
 * to a delegation cap.
 */
export async function withClockCap<T>(
  promise: Promise<T>,
  timeoutMs: number,
  subAgent: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const clock = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new DelegationTimeoutError(subAgent, timeoutMs))
    }, timeoutMs)
  })
  try {
    return await Promise.race([promise, clock])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** An agent that must be released, and the release. */
export interface EphemeralAgent<TAgent> {
  readonly agent: TAgent
  readonly dispose: () => void | Promise<void>
}

/**
 * Run `body` against a freshly created agent and dispose it afterwards, whatever happens.
 *
 * ## Why the disposal cannot mask the result
 *
 * `Promise.allSettled` semantics, named by the milestone: the body's outcome — value OR error — is
 * what the caller receives, and a failing `dispose` never replaces it.
 *
 * A cleanup that threw over a successful run would report a teardown error for work that actually
 * succeeded. Worse, a cleanup that threw over a FAILED run would replace the real failure with the
 * teardown one, and the diagnosis the caller needed is gone. That asymmetry is precisely what the
 * two hand-written call sites got wrong, each with its own bug-fix comment about `finally`.
 *
 * The disposal error is not silently swallowed either — it is reported through `onDisposeError`, so
 * a leak is observable without competing with the result.
 */
export async function withEphemeralAgent<TAgent, TResult>(
  create: () => EphemeralAgent<TAgent> | Promise<EphemeralAgent<TAgent>>,
  body: (agent: TAgent) => Promise<TResult>,
  options: { readonly onDisposeError?: (error: unknown) => void } = {},
): Promise<TResult> {
  const { agent, dispose } = await create()
  try {
    return await body(agent)
  } finally {
    // `await` inside `finally` so an async dispose actually completes before the caller continues —
    // a fire-and-forget release is a leak with better timing.
    try {
      await dispose()
    } catch (error) {
      options.onDisposeError?.(error)
    }
  }
}
