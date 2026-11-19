import type { PoolLike } from '../storage/storage-types.js'

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

/**
 * Options forwarded to `backend.enqueue` at outbox flush time.
 */
export interface EnqueueOptions {
  /** Optional idempotency key for at-most-once dispatch within TTL. */
  idempotencyKey?: string
  /** Optional delay before the job becomes available. */
  delaySeconds?: number
}

/**
 * Typed queue client. `enqueue` returns `void` and buffers
 * to the per-request outbox. `enqueueWithId` is the log-correlation
 * variant that resolves to `{ jobId }` AFTER the outbox flushes.
 *
 * Type inference: `JobName extends keyof JobRegistry`. Users extend the
 * `JobRegistry` interface via module augmentation (see `job-types.ts`).
 * Without augmentation, all enqueue calls compile-error with "Type X is
 * not assignable to type never" — documented in EC-110 as a known onboarding
 * friction.
 */
export interface QueueClient {
  /** Buffer a job to the outbox. Returns void (fire-and-forget). */
  enqueue<JobName extends keyof JobRegistry>(
    name: JobName,
    input: JobRegistry[JobName],
    opts?: EnqueueOptions,
  ): void
  /**
   * Buffer a job AND return a Promise that resolves with the jobId
   * AFTER the outbox flushes (i.e., after the response commits, or after a job or cron handler
   * returns). NOT a handle to await the job result — there is no result API. Do not await it
   * inside a job or cron handler: it settles only after the handler returns, so awaiting it there
   * never finishes.
   */
  enqueueWithId<JobName extends keyof JobRegistry>(
    name: JobName,
    input: JobRegistry[JobName],
    opts?: EnqueueOptions,
  ): Promise<{ jobId: string }>
  /**
   * Write the job NOW through `client`, a connection inside a transaction you opened, so it commits
   * or rolls back with your own writes (usetheokit/theokit#1077). It bypasses the per-request
   * outbox: the response status (or a job or cron handler's outcome) does not decide whether the
   * job exists, your transaction does.
   * Needs a backend with `enqueueInTransaction` (`PostgresJobBackend`, whose table must live in the
   * database `client` is connected to); any other backend rejects with
   * `TransactionalEnqueueUnsupportedError`.
   */
  enqueueInTransaction<JobName extends keyof JobRegistry>(
    client: PoolLike,
    name: JobName,
    input: JobRegistry[JobName],
    opts?: EnqueueOptions,
  ): Promise<{ jobId: string }>
  /**
   * Remove the queued job `(name, idempotencyKey)` through `client`, inside your transaction, so
   * the removal commits or rolls back with your writes (usetheokit/theokit#2118). Resolves `true`
   * when a job was removed, `false` when none was: a job a worker leased (even with an expired
   * lease) or that failed is left alone. A backend without `cancelInTransaction` rejects with
   * `TransactionalCancelUnsupportedError`.
   */
  cancelInTransaction(
    client: PoolLike,
    name: keyof JobRegistry,
    opts: { idempotencyKey: string },
  ): Promise<boolean>
}

export interface JobContext<TInput = unknown> {
  /**
   * Enqueue follow-up jobs from this handler. Jobs buffered with `enqueue` are dispatched after the
   * handler returns and dropped if it throws; they carry this job's trace. Use
   * `enqueueInTransaction` to tie a job to your own database transaction.
   */
  readonly queue: QueueClient
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
