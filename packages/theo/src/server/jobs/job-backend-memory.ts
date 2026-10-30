// T5a.1a — Web Standards migration (leaf-first slice). Web Crypto's
// `crypto.randomUUID()` is available on globalThis in every supported
// runtime per ADR-0028 (Node 22+, CF Workers, Bun, Deno, browsers).
// No node:crypto import needed.

import {
  type JobBackend,
  type JobEnqueueInput,
  type JobLease,
  type JobLeaseFence,
  type JobNackOptions,
  JobLeaseLostError,
} from './job-backend.js'

/**
 * In-memory job backend for dev + tests + single-instance prototypes.
 *
 * Zero external dependencies. Storage is two Maps:
 *   - `pending: Map<jobId, PendingEntry>` — all enqueued jobs (locked or not)
 *   - `idempotencyMap: Map<name + key, { key; jobId; expiresAt }>` — dedup
 *     window, scoped to the job name like PostgresJobBackend's unique index
 *
 * A job that fails for good is dropped with a `console.warn` naming it and its
 * last error; this backend keeps no failed jobs and retries immediately, with
 * no backoff. `PostgresJobBackend` keeps failed jobs and backs off.
 *
 * Per ADR-0002: this is one of two first-party backends shipped in core.
 * Production deploys plug in PostgresJobBackend (T3.1).
 *
 * EC-104 (jobs-crons-webhooks-cost-tracking-plan): registers a
 * `process.on('beforeExit')` handler that clears pending dispatch timers
 * and logs a warning with the dropped count. Failure mode is visible,
 * not silent. `destroy()` removes the listener for test isolation.
 */

export interface InMemoryJobBackendOptions {
  /** Maximum pending entries before oldest is dropped + warning logged. */
  maxPending?: number
}

interface PendingEntry {
  jobId: string
  name: string
  input: unknown
  attempts: number
  maxAttempts: number
  traceparent?: string
  availableAt: number
  lockExpiresAt: number | null
  leaseToken: string | null
  dispatchTimer: NodeJS.Timeout | null
}

interface IdempotencyEntry {
  key: string
  jobId: string
  expiresAt: number
}

const DEFAULT_MAX_PENDING = 10_000

/** A job name cannot contain NUL (`defineJob` allows `[a-z0-9-]`), so the pair cannot collide. */
const scopedKey = (name: string, key: string): string => `${name}\u0000${key}`

export class InMemoryJobBackend implements JobBackend {
  readonly name = 'memory'
  readonly #pending = new Map<string, PendingEntry>()
  readonly #idempotency = new Map<string, IdempotencyEntry>()
  readonly #maxPending: number
  #beforeExitHandler: (() => void) | null = null
  #destroyed = false

  constructor(opts: InMemoryJobBackendOptions = {}) {
    this.#maxPending = opts.maxPending ?? DEFAULT_MAX_PENDING
    // EC-104 — register graceful shutdown handler. We keep a reference
    // so `destroy()` can remove it (test isolation; avoid leaking
    // listeners across vitest test files).
    this.#beforeExitHandler = (): void => {
      this.#cleanupOnShutdown()
    }
    process.on('beforeExit', this.#beforeExitHandler)
  }

  async enqueue(input: JobEnqueueInput): Promise<{ jobId: string }> {
    // Overflow eviction (visible failure, not silent leak)
    if (this.#pending.size >= this.#maxPending) {
      const oldestKey = this.#pending.keys().next().value
      if (oldestKey) {
        const oldest = this.#pending.get(oldestKey)
        if (oldest?.dispatchTimer) clearTimeout(oldest.dispatchTimer)
        this.#pending.delete(oldestKey)
      }

      console.warn(
        `[theokit:jobs:memory] pending overflow at ${this.#maxPending} — dropped oldest. ` +
          'Switch to PostgresJobBackend for production.',
      )
    }

    // Idempotency dedup
    if (input.idempotencyKey) {
      const existing = this.#idempotency.get(scopedKey(input.name, input.idempotencyKey))
      const now = Date.now()
      if (existing && existing.expiresAt > now) {
        return { jobId: existing.jobId }
      }
    }

    const jobId = globalThis.crypto.randomUUID()
    const now = Date.now()
    const availableAt = now + (input.delaySeconds ?? 0) * 1000
    const entry: PendingEntry = {
      jobId,
      name: input.name,
      input: input.input,
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 1,
      traceparent: input.traceparent,
      availableAt,
      lockExpiresAt: null,
      leaseToken: null,
      dispatchTimer: null,
    }
    this.#pending.set(jobId, entry)

    if (input.idempotencyKey) {
      // Default TTL window matches typical idempotency expectations;
      // explicit idempotency(key, ttl) check overrides per caller.
      this.#idempotency.set(scopedKey(input.name, input.idempotencyKey), {
        key: input.idempotencyKey,
        jobId,
        expiresAt: now + 60_000,
      })
    }

    return Promise.resolve({ jobId })
  }

  async dequeue(opts: { batchSize?: number; lockSeconds?: number }): Promise<JobLease[]> {
    const batchSize = opts.batchSize ?? 1
    const lockSeconds = opts.lockSeconds ?? 30
    const now = Date.now()

    const leases: JobLease[] = []
    for (const entry of this.#pending.values()) {
      if (leases.length >= batchSize) break
      // Skip if locked + lock still valid
      if (entry.lockExpiresAt !== null && entry.lockExpiresAt > now) continue
      // Skip if not yet available (delay)
      if (entry.availableAt > now) continue

      entry.lockExpiresAt = now + lockSeconds * 1000
      entry.leaseToken = globalThis.crypto.randomUUID()
      entry.attempts += 1
      leases.push({
        jobId: entry.jobId,
        name: entry.name,
        input: entry.input,
        attempts: entry.attempts,
        maxAttempts: entry.maxAttempts,
        traceparent: entry.traceparent,
        lockExpiresAt: new Date(entry.lockExpiresAt),
        leaseToken: entry.leaseToken,
      })
    }
    return Promise.resolve(leases)
  }

  async ack(jobId: string, fence?: JobLeaseFence): Promise<void> {
    const entry = this.#pending.get(jobId)
    this.#assertHeld(jobId, entry, fence, 'ack')
    if (entry?.dispatchTimer) clearTimeout(entry.dispatchTimer)
    this.#pending.delete(jobId)
    return Promise.resolve()
  }

  async nack(jobId: string, opts: JobNackOptions): Promise<void> {
    const entry = this.#pending.get(jobId)
    this.#assertHeld(jobId, entry, opts, 'nack')
    if (!entry) return Promise.resolve()
    if (opts.nonRetryable || entry.attempts >= (opts.maxAttempts ?? entry.maxAttempts)) {
      if (entry.dispatchTimer) clearTimeout(entry.dispatchTimer)
      this.#pending.delete(jobId)
      // This backend keeps no failed jobs; say so instead of dropping one silently
      // (usetheokit/theokit#1014). PostgresJobBackend keeps them with `last_error`.
      console.warn(
        `[theokit:jobs:memory] job "${entry.name}" (${jobId}) failed after ${String(entry.attempts)} ` +
          `attempt(s) and was dropped: ${opts.error}`,
      )
    } else {
      // Release lock — becomes available again
      entry.lockExpiresAt = null
      entry.leaseToken = null
    }
    return Promise.resolve()
  }

  /**
   * The job holding `key` within its window, or null. With `name`, only that job type's key
   * matches, as `enqueue` deduplicates on (name, key); without it, the first job holding the key.
   */
  idempotency(key: string, ttlSeconds: number, name?: string): Promise<{ jobId: string } | null> {
    const now = Date.now()
    const existing =
      name === undefined
        ? [...this.#idempotency.values()].find((e) => e.key === key && e.expiresAt > now)
        : this.#idempotency.get(scopedKey(name, key))
    if (!existing || existing.expiresAt <= now) {
      return Promise.resolve(null)
    }
    // Renew if caller's ttl differs
    existing.expiresAt = Math.max(existing.expiresAt, now + ttlSeconds * 1000)
    return Promise.resolve({ jobId: existing.jobId })
  }

  /**
   * Remove the beforeExit listener and clear all pending timers.
   * Idempotent — safe to call multiple times. Use in test teardown to
   * avoid leaking listeners across vitest test files.
   */
  destroy(): void {
    if (this.#destroyed) return
    this.#destroyed = true
    if (this.#beforeExitHandler) {
      process.off('beforeExit', this.#beforeExitHandler)
      this.#beforeExitHandler = null
    }
    for (const entry of this.#pending.values()) {
      if (entry.dispatchTimer) clearTimeout(entry.dispatchTimer)
    }
  }

  /** A fenced call whose lease no longer holds the job is refused (usetheokit/theokit#1012). */
  #assertHeld(
    jobId: string,
    entry: PendingEntry | undefined,
    fence: JobLeaseFence | undefined,
    operation: 'ack' | 'nack',
  ): void {
    if (fence?.leaseToken === undefined) return
    if (entry?.leaseToken !== fence.leaseToken) throw new JobLeaseLostError(jobId, operation)
  }

  /** EC-104 test hook — invokes the shutdown handler synchronously. */
  triggerBeforeExitForTest(): void {
    this.#cleanupOnShutdown()
  }

  #cleanupOnShutdown(): void {
    const droppedCount = this.#pending.size
    for (const entry of this.#pending.values()) {
      if (entry.dispatchTimer) clearTimeout(entry.dispatchTimer)
    }
    if (droppedCount > 0) {
      console.warn(
        `[theokit:jobs:memory] ${droppedCount} jobs dropped on shutdown — ` +
          'use PostgresJobBackend for durability across restarts.',
      )
    }
  }
}
