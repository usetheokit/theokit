/**
 * Job primitive types (R0.5.5-9).
 */

/**
 * Type registry for jobs. Users extend via module augmentation:
 *
 * ```ts
 * declare module 'theokit/server/jobs' {
 *   interface JobRegistry {
 *     'process-document': { documentId: string }
 *     'send-email': { to: string; subject: string }
 *   }
 * }
 * ```
 *
 * Augment `theokit/server/jobs`, the module `QueueClient` is declared in. The deprecated
 * `theokit/server` reaches `QueueClient` only when some file also imports that umbrella, so in an
 * app that imports subpaths only every job name stayed `never` (usetheokit/theokit#1074).
 *
 * Once augmented, `ctx.queue.enqueue<'process-document'>(...)` gets full
 * type inference on the `input` argument.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface JobRegistry {}

export interface JobContext<TInput = unknown> {
  /** W3C trace_id propagated from the originating request or cron. */
  readonly traceId: string
  /** The job's input, type-narrowed per JobRegistry entry. */
  readonly input: TInput
  /** Abort signal triggered when the worker stops or lease times out. */
  readonly signal: AbortSignal
  /** Attempt number (1-indexed). */
  readonly attempt: number
  /**
   * Keep this job's lease for `seconds` more, counted from now (default: the lock the worker leased
   * with), and move the deadline of `signal` with it. Call it while the handler is making
   * progress, so a job that may run long does not need a long `lockSeconds` for every job.
   * Rejects with `JobLeaseLostError` (and aborts `signal`) when another worker holds the job now,
   * and with `JobLeaseExtensionUnsupportedError` when the backend cannot extend a lease
   * (usetheokit/theokit#1132).
   */
  extendLease(seconds?: number): Promise<void>
}

export interface JobOptions<TInput = unknown> {
  /** Optional Zod schema (or any `.parse(value)`-shaped object) for input validation. */
  input?: { parse: (value: unknown) => TInput }
  /** Maximum dispatch attempts (default 1, so nothing retries unless the job asks for it). */
  maxAttempts?: number
  /** Handler. Returns `void`: there is no workflow API. */
  handler: (ctx: JobContext<TInput>) => Promise<void> | void
}

export interface JobDefinition<TInput = unknown> {
  readonly name: string
  readonly maxAttempts: number
  readonly hasInputSchema: boolean
  readonly handler: (ctx: JobContext<TInput>) => Promise<void> | void
  readonly inputSchema?: { parse: (value: unknown) => TInput }
}
