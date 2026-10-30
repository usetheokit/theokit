import type { PostgresFactory, StorageManager } from '../storage/storage-manager.js'
import type { PoolLike } from '../storage/storage-types.js'

import {
  type JobBackend,
  type JobEnqueueInput,
  type JobLease,
  type JobLeaseFence,
  type JobNackOptions,
  JobLeaseLostError,
} from './job-backend.js'

/**
 * Postgres-backed `JobBackend` per ADR-0002 (T3.1).
 *
 * Uses the Graphile Worker pattern:
 *   - Single `theokit_jobs` table.
 *   - Dequeue via one `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
 *     LOCKED) RETURNING` statement, so the claim and the lease are atomic and
 *     concurrent workers never lease the same job.
 *   - Idempotency via UNIQUE INDEX on (name, idempotency_key).
 *
 * `pg` is an OPTIONAL peer dependency — the caller provides their own
 * `pg.Pool` (or compatible). This avoids forcing every TheoKit user to
 * install Postgres tooling for in-memory dev work.
 *
 * Pool size recommendation (EC-108): set `connectionTimeoutMillis` to
 * a finite value (e.g., 5000) so a saturated pool errors instead of
 * deadlocking. Suggested pool size: `min(workerConcurrency * 1.5, 20)`.
 *
 * @see https://github.com/graphile/worker (Postgres SKIP LOCKED reference)
 */

/**
 * `PoolLike` moved to `../storage/storage-types.ts` (T0.2 / ADR-0007 D7) to
 * deduplicate the shape across multiple adapters. Re-exported here so existing
 * `import { PoolLike } from 'theokit/server'` (which routes through the jobs
 * barrel today) continues to compile unchanged.
 */
export type { PoolLike } from '../storage/storage-types.js'

export interface PostgresJobBackendOptions {
  pool: PoolLike
  /** Table name override (default `theokit_jobs`). */
  tableName?: string
}

const DEFAULT_TABLE = 'theokit_jobs'

export class PostgresJobBackend implements JobBackend {
  readonly name = 'postgres'
  readonly #pool: PoolLike
  readonly #table: string

  constructor(opts: PostgresJobBackendOptions) {
    // Runtime guard for users who pass `pool: undefined` despite the type;
    // helps surface "you forgot to install pg" early with an actionable
    // error rather than a cryptic TypeError later.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!opts.pool) {
      throw new Error(
        'PostgresJobBackend requires a `pool` option (pg.Pool or compatible). ' +
          'Install pg via `pnpm add pg` and pass a configured Pool instance.',
      )
    }
    this.#pool = opts.pool
    this.#table = opts.tableName ?? DEFAULT_TABLE
  }

  /**
   * T2.1 — Construct a `PostgresJobBackend` using a pool managed by the
   * shared `StorageManager`. The manager caches the pool per `dbName`, so
   * repeated calls (in the same process) re-use the same connection pool.
   *
   * Equivalent to:
   *   ```ts
   *   const pool = manager.usePostgres(dbName, factory)
   *   new PostgresJobBackend({ pool, ...options })
   *   ```
   *
   * Errors thrown by the manager (unknown dbName, dangling server reference,
   * manager already disposed) propagate to the caller with actionable text.
   *
   * @see ADR-0007
   */
  static fromStorageManager(
    manager: StorageManager,
    dbName: string,
    factory: PostgresFactory,
    options?: Omit<PostgresJobBackendOptions, 'pool'>,
  ): PostgresJobBackend {
    const pool = manager.usePostgres(dbName, factory)
    return new PostgresJobBackend({ pool, ...options })
  }

  /**
   * Create or upgrade the schema. Idempotent (uses IF NOT EXISTS).
   * Call once at process start; safe to re-run on every deploy.
   */
  async migrate(): Promise<void> {
    const t = this.#table
    await this.#pool.query(`
      CREATE TABLE IF NOT EXISTS ${t} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        input JSONB NOT NULL,
        attempts INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 1,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        locked_until TIMESTAMPTZ,
        traceparent TEXT,
        idempotency_key TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lease_token TEXT
      )
    `)
    // Columns added after the first release. `CREATE TABLE IF NOT EXISTS` leaves a table created by
    // an earlier version untouched, so each later column is added here as well.
    await this.#pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS lease_token TEXT`)
    await this.#pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ${t}_idempotency_key_idx
      ON ${t} (name, idempotency_key)
      WHERE idempotency_key IS NOT NULL
    `)
    await this.#pool.query(`
      CREATE INDEX IF NOT EXISTS ${t}_available_at_idx
      ON ${t} (available_at)
      WHERE locked_until IS NULL
    `)
  }

  async enqueue(input: JobEnqueueInput): Promise<{ jobId: string }> {
    const id = randomId()
    const delaySeconds = input.delaySeconds ?? 0
    const t = this.#table

    // Idempotency: explicit SELECT-then-INSERT. The UNIQUE INDEX is the
    // safety net under race conditions (we surface the conflict by
    // re-selecting on insert-error). This 2-step path is pg-mem compatible
    // AND works on real Postgres.
    if (input.idempotencyKey) {
      const existing = await this.#pool.query<{ id: string }>(
        `SELECT id FROM ${t} WHERE name = $1 AND idempotency_key = $2 LIMIT 1`,
        [input.name, input.idempotencyKey],
      )
      if (existing.rows.length > 0) {
        return { jobId: existing.rows[0].id }
      }
    }

    await this.#pool.query(
      `INSERT INTO ${t} (id, name, input, max_attempts, available_at, traceparent, idempotency_key)
       VALUES ($1, $2, $3::jsonb, $4, NOW() + ($5 || ' seconds')::interval, $6, $7)`,
      [
        id,
        input.name,
        JSON.stringify(input.input),
        input.maxAttempts ?? 1,
        delaySeconds.toString(),
        input.traceparent ?? null,
        input.idempotencyKey ?? null,
      ],
    )
    return { jobId: id }
  }

  async dequeue(opts: { batchSize?: number; lockSeconds?: number }): Promise<JobLease[]> {
    const t = this.#table
    const batchSize = opts.batchSize ?? 1
    const lockSeconds = opts.lockSeconds ?? 30

    // Claim and mark in ONE statement. The row lock taken by `FOR UPDATE SKIP LOCKED` lasts only
    // as long as the statement's transaction. As two autocommit `pool.query()` calls (a SELECT, then
    // an UPDATE), the lock ended when the SELECT returned, and another worker could select the same
    // id before the UPDATE landed: 20 workers over 200 jobs leased 162 to 178 of them more than once
    // (usetheokit/theokit#1011). Inside one UPDATE the subquery's lock is held until the lease is
    // written, so a concurrent worker skips the row instead of claiming it again.
    const r = await this.#pool.query<{
      id: string
      name: string
      input: unknown
      attempts: number
      max_attempts: number
      traceparent: string | null
      locked_until: Date | string
      lease_token: string
    }>(
      `UPDATE ${t}
       SET locked_until = NOW() + ($2 || ' seconds')::interval,
           attempts = attempts + 1,
           lease_token = $3
       WHERE id IN (
         SELECT id FROM ${t}
         WHERE (locked_until IS NULL OR locked_until < NOW())
           AND available_at <= NOW()
         ORDER BY available_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, name, input, attempts, max_attempts, traceparent, locked_until, lease_token`,
      [batchSize, lockSeconds.toString(), randomId()],
    )

    return r.rows.map((row) => ({
      jobId: row.id,
      name: row.name,
      input: row.input,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      traceparent: row.traceparent ?? undefined,
      lockExpiresAt:
        row.locked_until instanceof Date ? row.locked_until : new Date(row.locked_until),
      leaseToken: row.lease_token,
    }))
  }

  async ack(jobId: string, fence?: JobLeaseFence): Promise<void> {
    const { clause, params } = this.#held(jobId, fence)
    const r = await this.#pool.query(
      `DELETE FROM ${this.#table} WHERE ${clause} RETURNING id`,
      params,
    )
    if (fence?.leaseToken !== undefined && r.rows.length === 0) {
      throw new JobLeaseLostError(jobId, 'ack')
    }
  }

  async nack(jobId: string, opts: JobNackOptions): Promise<void> {
    const t = this.#table
    const { clause, params } = this.#held(jobId, opts)
    const lost = (): never => {
      throw new JobLeaseLostError(jobId, 'nack')
    }
    const fenced = opts.leaseToken !== undefined
    if (opts.nonRetryable) {
      const r = await this.#pool.query(`DELETE FROM ${t} WHERE ${clause} RETURNING id`, params)
      if (fenced && r.rows.length === 0) lost()
      return
    }
    // Check attempts >= maxAttempts → permanent removal.
    const r = await this.#pool.query<{
      attempts: number
      max_attempts: number
    }>(`SELECT attempts, max_attempts FROM ${t} WHERE ${clause}`, params)
    if (r.rows.length === 0) {
      if (fenced) lost()
      return
    }
    const { attempts, max_attempts } = r.rows[0]
    const write =
      attempts >= (opts.maxAttempts ?? max_attempts)
        ? `DELETE FROM ${t} WHERE ${clause} RETURNING id`
        : // Release lock — next dequeue picks it up again.
          `UPDATE ${t} SET locked_until = NULL, lease_token = NULL WHERE ${clause} RETURNING id`
    const w = await this.#pool.query(write, params)
    if (fenced && w.rows.length === 0) lost()
  }

  /**
   * The row predicate for a call that finishes a job. Fenced by the lease token when the caller
   * passed one: a worker whose lease expired and was re-leased no longer matches, so its late
   * ack or nack cannot touch the new holder's job (usetheokit/theokit#1012).
   */
  #held(jobId: string, fence?: JobLeaseFence): { clause: string; params: unknown[] } {
    return fence?.leaseToken === undefined
      ? { clause: 'id = $1', params: [jobId] }
      : { clause: 'id = $1 AND lease_token = $2', params: [jobId, fence.leaseToken] }
  }

  async idempotency(key: string, _ttlSeconds: number): Promise<{ jobId: string } | null> {
    // The UNIQUE INDEX is the source of truth. Look for any non-deleted
    // row with this idempotency_key.
    const r = await this.#pool.query<{ id: string }>(
      `SELECT id FROM ${this.#table} WHERE idempotency_key = $1 LIMIT 1`,
      [key],
    )
    return r.rows.length > 0 ? { jobId: r.rows[0].id } : null
  }
}

function randomId(): string {
  // Use crypto.randomUUID if available; this is process-local, not DB-generated.
  // The DB UNIQUE constraint is on (name, idempotency_key), not on id, so
  // collisions across processes are functionally impossible.
  return globalThis.crypto.randomUUID()
}
