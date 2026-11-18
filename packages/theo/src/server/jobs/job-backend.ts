/**
 * Neutral `JobBackend` interface.
 *
 * Implementations ship in core:
 *   - `InMemoryJobBackend` (T2.2) — dev + tests; no external deps
 *   - `PostgresJobBackend` (T3.1) — production; requires `pg` peer dep
 *
 * Community packages (`@theokit/jobs-redis`, `@theokit/jobs-sqs`, etc.)
 * implement this same interface to plug in alternate substrates without
 * modifying TheoKit core.
 */

import type { PoolLike } from '../storage/storage-types.js'

export interface JobEnqueueInput {
  /** The job name (matches a `defineJob` declaration). */
  name: string
  /** Validated input (already passed through Zod or equivalent at the queue-client layer). */
  input: unknown
  /**
   * Optional idempotency key, scoped to `name`: a second enqueue of the same (name, key) returns the
   * first job's id instead of creating a job, including when the two calls race. The window is
   * backend-specific: `PostgresJobBackend` holds the key while the row exists (until `ack`, or for
   * good once the job has failed); `InMemoryJobBackend` holds it for 60 seconds.
   */
  idempotencyKey?: string
  /** Optional delay before the job becomes available for dispatch. */
  delaySeconds?: number
  /** W3C Trace Context propagation per ADR/R0.5.9. */
  traceparent?: string
  /**
   * Maximum dispatch attempts stored with the job (default 1). The queue client has no access to
   * the job definitions and leaves it unset; `createJobRunner` passes the definition's
   * `maxAttempts` to `nack`, which takes precedence over this stored value.
   */
  maxAttempts?: number
}

export interface JobLease {
  readonly jobId: string
  readonly name: string
  readonly input: unknown
  readonly attempts: number
  readonly maxAttempts: number
  readonly traceparent?: string
  readonly lockExpiresAt: Date
  /**
   * Identifies THIS lease. Pass it back to `ack`/`nack` so a worker whose lease expired, and was
   * handed to another worker, cannot finish the job on the new holder's behalf. Both first-party
   * backends set it; optional so a backend written against the earlier contract still compiles.
   */
  readonly leaseToken?: string
}

/** What `nack` is told about the failure. */
export interface JobNackOptions extends JobLeaseFence {
  /** The failure message. */
  error: string
  /** The handler threw `NonRetryableError`: no retry, whatever the attempts left. */
  nonRetryable?: boolean
  /**
   * The retry ceiling from the job's definition. Takes precedence over the value stored at
   * enqueue, which is 1 for every job enqueued through the queue client.
   */
  maxAttempts?: number
}

/** Fences `ack`/`nack` to the lease that is finishing the job. */
export interface JobLeaseFence {
  /** The `leaseToken` of the `JobLease` being finished. Omitted, the call is not fenced. */
  leaseToken?: string
}

export interface JobBackend {
  /** Human-readable name for logging (e.g., "memory", "postgres"). */
  readonly name: string

  /** Persist a job for later dispatch. Returns the generated jobId. */
  enqueue(input: JobEnqueueInput): Promise<{ jobId: string }>

  /** Worker loop polls for the next available leases. */
  dequeue(opts: { batchSize?: number; lockSeconds?: number }): Promise<JobLease[]>

  /**
   * Mark a job complete (success). With `leaseToken`, rejects with `JobLeaseLostError` and leaves
   * the job alone when that lease no longer holds it.
   */
  ack(jobId: string, fence?: JobLeaseFence): Promise<void>

  /**
   * Mark a job failed; backend decides retry vs DLQ via attempts. With `leaseToken`, rejects with
   * `JobLeaseLostError` and leaves the job alone when that lease no longer holds it.
   */
  nack(jobId: string, opts: JobNackOptions): Promise<void>

  /**
   * Optional: keep a lease for `lockSeconds` more, counted from now, and return the new deadline.
   * A handler that is still making progress calls it (through `ctx.extendLease`) so a job that may
   * run for a long time does not need a long lock for every job. Rejects with `JobLeaseLostError`
   * (`operation: 'extend'`) when `leaseToken` no longer holds the job: the lease expired and was
   * handed on, or the job is gone (usetheokit/theokit#1132). A backend that leaves it out cannot
   * have its leases extended, and `ctx.extendLease` says so.
   */
  extendLease?(jobId: string, opts: { leaseToken: string; lockSeconds: number }): Promise<Date>

  /**
   * Optional: persist a job through `client`, a connection inside a transaction the caller opened,
   * so the job commits or rolls back with the caller's writes (usetheokit/theokit#1077). Only a
   * backend whose jobs live in the caller's database can offer it; `ctx.queue.enqueueInTransaction`
   * refuses a backend without it rather than enqueueing outside the transaction.
   */
  enqueueInTransaction?(client: PoolLike, input: JobEnqueueInput): Promise<{ jobId: string }>

  /**
   * Optional: resolve when the backend's store answers, reject when it does not. `GET /__theo/ready`
   * calls it under `theokit start` and `theokit dev`, so an unreachable job store answers 503
   * (usetheokit/theokit#1071). A backend with nothing remote to reach leaves it out.
   */
  ping?(): Promise<void>

  /**
   * Optional: create or upgrade whatever storage the backend needs (a table, an index). Must be
   * idempotent and safe to run from several processes at once. `theokit start` and `theokit dev`
   * call it once at boot, before serving a request or starting the worker, and refuse to boot when
   * it rejects (usetheokit/theokit#1072). A backend that needs no setup leaves it out.
   */
  migrate?(): Promise<void>

  /**
   * Optional: return the existing jobId if `key` was enqueued within `ttlSeconds`. Pass `name` to
   * scope the lookup to one job type, as `enqueue` deduplicates on (name, key); without it, a key
   * shared by two job types may return either job.
   */
  idempotency?(key: string, ttlSeconds: number, name?: string): Promise<{ jobId: string } | null>
}

/**
 * Thrown from a job handler to opt out of retry policy. The runner nacks with
 * `nonRetryable: true` and the backend never retries the job: `PostgresJobBackend`
 * keeps it as failed with the error, `InMemoryJobBackend` drops it with a warning.
 */
export class NonRetryableError extends Error {
  readonly code = 'NON_RETRYABLE'
  constructor(message: string) {
    super(message)
    this.name = 'NonRetryableError'
  }
}

/**
 * `ack`/`nack` was called with a lease token that no longer holds the job: the lease expired and
 * another worker leased the job again (or the job is gone). The job is left untouched, because the
 * current holder owns its outcome. The runner logs it and moves on; a direct caller decides.
 */
export class JobLeaseLostError extends Error {
  readonly code = 'JOB_LEASE_LOST'
  readonly jobId: string
  readonly operation: 'ack' | 'nack' | 'extend'
  constructor(jobId: string, operation: 'ack' | 'nack' | 'extend') {
    super(
      `Cannot ${operation} job "${jobId}": its lease expired and another worker holds it now, ` +
        'or the job no longer exists. The current holder decides its outcome.',
    )
    this.name = 'JobLeaseLostError'
    this.jobId = jobId
    this.operation = operation
  }
}

/**
 * `ctx.extendLease` was called on a job whose backend has no `extendLease`. The lease keeps its
 * original deadline and `ctx.signal` aborts when it passes.
 */
export class JobLeaseExtensionUnsupportedError extends Error {
  readonly code = 'JOB_LEASE_EXTENSION_UNSUPPORTED'
  readonly backend: string
  constructor(backend: string) {
    super(
      `The "${backend}" job backend cannot extend a lease. Give the worker a lockSeconds longer ` +
        'than the longest job, or use a backend that implements extendLease.',
    )
    this.name = 'JobLeaseExtensionUnsupportedError'
    this.backend = backend
  }
}
