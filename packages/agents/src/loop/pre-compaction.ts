import type { CompressibleMessage } from '@theokit/sdk/compaction'
import { TheokitAgentError } from '@theokit/sdk/errors'

import type { CompactionCallOptions, TranscriptCompactionStrategy } from './compaction-strategy.js'

/**
 * B-002 FR-001..003 — run work BEFORE compaction rewrites the transcript, and await it.
 *
 * A Decorator over {@link TranscriptCompactionStrategy} rather than a field on the call options or
 * on the strategy config (plan ADR-1). The requirement is REGISTRATION: a consumer registers once
 * and every `compact` on that strategy carries the handler, where a per-call option is silently
 * absent from whichever call site forgot it. The strategy config is the serializable shape, and a
 * function is not serializable.
 *
 * The decorated value satisfies the same interface, so every existing consumer accepts it unchanged.
 *
 * ## What this seam does NOT cover
 *
 * The SDK's auto-compaction path. When usage crosses its threshold the SDK compacts inside
 * `persistTurnToTranscript`, builds its own summarizer, and fires `onCompact` afterwards — there is
 * no consumer callback on that path and none can be added from here. Stated rather than left to be
 * discovered by a handler that never fires; tracked upstream as `usetheokit/theokit-sdk#653`.
 */

/**
 * Work to run before the transcript is rewritten.
 *
 * Receives a READONLY view of the pre-compaction transcript — the reason the handler exists is to
 * read what compaction is about to destroy. The array is a copy: `compact` documents that it never
 * mutates its input, and handing a caller the live array would open a mutation path through that
 * contract whose damage surfaces later, in the compacted output, pointing at nothing.
 */
export type PreCompactionHandler = (
  messages: readonly CompressibleMessage[],
) => void | Promise<void>

/** How a failed handler is reported, and how long one may take. */
export interface PreCompactionOptions {
  /**
   * How long the handler may take before it is abandoned. Default {@link DEFAULT_HANDLER_TIMEOUT_MS}.
   *
   * A bound is required rather than optional: without one a handler that never resolves holds the
   * compaction forever and the run meets the context wall instead — the outcome the seam exists to
   * avoid. Generous by default, because a handler doing real persistence is slow, not broken.
   */
  readonly timeoutMs?: number
  /**
   * Called with the typed error when the handler fails or times out.
   *
   * Reported, never swallowed, and never fatal: compaction proceeds either way, because a run that
   * cannot compact is worse off than one whose handler failed. Omitting this is opting into silence.
   */
  readonly onError?: (error: PreCompactionHandlerError) => void
}

/** Default bound on a handler: generous, because slow is not the same as hung. */
export const DEFAULT_HANDLER_TIMEOUT_MS = 30_000

/**
 * A pre-compaction handler rejected, threw, or exceeded its bound. Compaction proceeded anyway.
 *
 * Extends `TheokitAgentError` and not plain `Error`, because this package's error taxonomy is what
 * `isTransientError` reads: an error outside it is invisible to every classifier downstream. The
 * first version of this class extended `Error` and `tests/unit/error-taxonomy.test.ts` refused it —
 * a gate worth more than the convention it enforces, since the failure it prevents is silent.
 *
 * `code` is stable so a caller can branch on the reason without matching message text.
 */
export class PreCompactionHandlerError extends TheokitAgentError {
  override readonly name = 'PreCompactionHandlerError'

  /** `'timeout'` when the bound was exceeded, `'threw'` when the handler failed on its own. */
  readonly reason: 'timeout' | 'threw'

  constructor(
    message: string,
    reason: 'timeout' | 'threw',
    options?: { readonly cause?: unknown },
  ) {
    super(message, { code: 'PRE_COMPACTION_HANDLER_FAILED', ...(options ?? {}) })
    this.reason = reason
  }
}

function assertUsableTimeout(timeoutMs: number): void {
  // Refused when the decorator is BUILT, not on the first compaction. A `timeoutMs: 0` accepted
  // silently reports every handler as timed out, which reads as "my handler never runs" and sends
  // the reader to the wrong file entirely.
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(
      `withPreCompaction: timeoutMs must be a finite number greater than 0, received ${String(timeoutMs)}`,
    )
  }
}

/**
 * Run `handler` to completion before `strategy.compact`, and report rather than propagate a failure.
 *
 * The handler is invoked INSIDE the try: a handler that throws synchronously never produces a
 * promise, so `const p = handler(); await p` would catch a rejection and let the throw escape.
 */
async function runHandlerBounded(
  handler: PreCompactionHandler,
  messages: readonly CompressibleMessage[],
  timeoutMs: number,
  onError?: (error: PreCompactionHandlerError) => void,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.resolve(handler(messages)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new PreCompactionHandlerError(
              `pre-compaction handler exceeded its ${String(timeoutMs)}ms bound; compaction proceeded without it`,
              'timeout',
            ),
          )
        }, timeoutMs)
      }),
    ])
  } catch (cause) {
    // Flattened out of a nested ternary: the message needs `cause`'s own text, and computing it
    // inside the branch that builds the error made two conditionals share one expression.
    const detail = cause instanceof Error ? cause.message : String(cause)
    const reported =
      cause instanceof PreCompactionHandlerError
        ? cause
        : new PreCompactionHandlerError(`pre-compaction handler failed: ${detail}`, 'threw', {
            cause,
          })
    onError?.(reported)
  } finally {
    // The handler wins this race on every normal call, leaving the timer pending. Unclear, Node
    // holds one live timer per compaction and the process outlives its work.
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Wrap `strategy` so `handler` runs, and is awaited, before the transcript is rewritten.
 *
 * Wrapping twice runs both handlers, outermost first — composition is the point of a decorator, and
 * the alternative (a list the decorator manages) makes ordering implicit.
 */
export function withPreCompaction(
  strategy: TranscriptCompactionStrategy,
  handler: PreCompactionHandler,
  options?: PreCompactionOptions,
): TranscriptCompactionStrategy {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_HANDLER_TIMEOUT_MS
  assertUsableTimeout(timeoutMs)
  const onError = options?.onError

  return {
    name: strategy.name,
    keepTokens: strategy.keepTokens,
    compact: async (
      messages: CompressibleMessage[],
      callOptions?: CompactionCallOptions,
    ): Promise<CompressibleMessage[]> => {
      await runHandlerBounded(handler, [...messages], timeoutMs, onError)
      // `callOptions` is forwarded, not dropped: it carries `summarize`, without which the SDK has
      // no summarizer, and `failSafe`, which decides whether a thrown one keeps the transcript.
      return strategy.compact(messages, callOptions)
    },
  }
}
