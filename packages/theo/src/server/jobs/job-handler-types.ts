/**
 * Job handler types. Kept apart from `job-types.ts` (which holds `JobRegistry`) because
 * `QueueClient` is keyed by `JobRegistry`: one file for both would be an import cycle.
 */

import type { QueueClient } from './queue-client.js'

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
