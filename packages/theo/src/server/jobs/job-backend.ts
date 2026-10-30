/**
 * Neutral `JobBackend` interface per ADR-0002.
 *
 * Implementations ship in core:
 *   - `InMemoryJobBackend` (T2.2) — dev + tests; no external deps
 *   - `PostgresJobBackend` (T3.1) — production; requires `pg` peer dep
 *
 * Community packages (`@theokit/jobs-redis`, `@theokit/jobs-sqs`, etc.)
 * implement this same interface to plug in alternate substrates without
 * modifying TheoKit core.
 */

export interface JobEnqueueInput {
  /** The job name (matches a `defineJob` declaration). */
  name: string
  /** Validated input (already passed through Zod or equivalent at the queue-client layer). */
  input: unknown
  /** Optional idempotency key for at-most-once dispatch within TTL. */
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

  /** Optional: return existing jobId if `key` was enqueued within `ttlSeconds`. */
  idempotency?(key: string, ttlSeconds: number): Promise<{ jobId: string } | null>
}

/**
 * Thrown from a job handler to opt out of retry policy. The backend MUST
 * nack with `nonRetryable: true` and permanently remove the job.
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
  readonly operation: 'ack' | 'nack'
  constructor(jobId: string, operation: 'ack' | 'nack') {
    super(
      `Cannot ${operation} job "${jobId}": its lease expired and another worker holds it now, ` +
        'or the job no longer exists. The current holder decides its outcome.',
    )
    this.name = 'JobLeaseLostError'
    this.jobId = jobId
    this.operation = operation
  }
}
