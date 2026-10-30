import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

import { defineJob } from '../../packages/theo/src/server/jobs/define-job.js'
import { JobLeaseLostError } from '../../packages/theo/src/server/jobs/job-backend.js'
import { createJobRunner } from '../../packages/theo/src/server/jobs/job-runner.js'
import { createOutbox } from '../../packages/theo/src/server/jobs/outbox.js'
import {
  createOutboxDispatcher,
  createQueueClient,
} from '../../packages/theo/src/server/jobs/queue-client.js'
import { PostgresJobBackend } from '../../packages/theo/src/server/jobs/job-backend-postgres.js'

const POSTGRES_URL = process.env.POSTGRES_URL

/**
 * Is the `pg` driver resolvable at all?
 *
 * Backlog B-M67-09 / #207 — this used to be an implicit assumption, and the comment here claimed the
 * dynamic import "keeps the test loadable even when pg isn't installed … resolved from
 * `packages/theo` node_modules in CI". Both halves were false: `pg` was declared in no manifest of
 * the workspace, and the dynamic import keeps the FILE loadable while `beforeAll` still explodes the
 * moment the suite runs — which it does, because the only guard was `skipIf(!POSTGRES_URL)` and CI
 * sets that variable.
 *
 * The result was `ERR_MODULE_NOT_FOUND`, six `skipped` tests and a red job, on `main` and `develop`,
 * for days. The SKIP LOCKED race-safety assertions — the only place the concurrent-dequeue semantics
 * are checked against a real Postgres — never executed.
 *
 * Resolved ONCE here, at module scope, so the decision is available to `skipIf` instead of being
 * discovered inside a hook.
 */
const pgModulePromise = import(/* @vite-ignore */ 'pg' as string).then(
  (m) => m as { Pool?: unknown; default?: { Pool?: unknown } },
  () => undefined,
)
const pgAvailable = (await pgModulePromise) !== undefined
interface PgQueryResult<R> {
  rows: R[]
  rowCount?: number | null
}
interface PgPoolLike {
  // The R generic IS used twice (call-site + return type) — eslint heuristic
  // misclassifies because the return type goes through PgQueryResult<R>.
  query<R>(sql: string, params?: unknown[]): Promise<PgQueryResult<R>>
  end: () => Promise<void>
}

describe.skipIf(!POSTGRES_URL)('PostgresJobBackend — real Postgres CI (T3.1)', () => {
  it('test_pg_is_installed_whenever_POSTGRES_URL_is_set', () => {
    // The anti-vacuity floor. Skipping when `pg` is missing would turn the job GREEN without a
    // single assertion having run — worse than the red it replaces, because a green gate is one
    // nobody re-reads. If the operator went to the trouble of pointing at a database, a missing
    // driver is a FAILURE, and this is the one test that says so in a sentence.
    expect(
      pgAvailable,
      'POSTGRES_URL is set but `pg` does not resolve — declare it in the root devDependencies ' +
        '(`pnpm add -Dw pg @types/pg`). Without it these tests silently do not run.',
    ).toBe(true)
  })
})

describe.skipIf(!POSTGRES_URL || !pgAvailable)(
  'PostgresJobBackend — real Postgres CI (T3.1)',
  () => {
    let pool: PgPoolLike
    let backend: PostgresJobBackend

    beforeAll(async () => {
      const pgModule = (await pgModulePromise)!
      const PoolCtor = (pgModule.Pool ?? pgModule.default?.Pool) as
        | (new (config: unknown) => PgPoolLike)
        | undefined
      if (!PoolCtor) throw new Error('pg.Pool not found in module export')
      pool = new PoolCtor({
        connectionString: POSTGRES_URL,
        max: 10,
        connectionTimeoutMillis: 5000,
      })
      backend = new PostgresJobBackend({ pool, tableName: 'theokit_jobs_ci' })
      await backend.migrate()
    })

    afterAll(async () => {
      await pool.query(`DROP TABLE IF EXISTS theokit_jobs_ci`)
      await pool.end()
    })

    beforeEach(async () => {
      await pool.query(`DELETE FROM theokit_jobs_ci`)
    })

    it('enqueue → row visible in DB', async () => {
      const { jobId } = await backend.enqueue({ name: 'test', input: { a: 1 } })
      const r = await pool.query<{ id: string }>(`SELECT id FROM theokit_jobs_ci WHERE id = $1`, [
        jobId,
      ])
      expect(r.rows.length).toBe(1)
    })

    // KEY test: SKIP LOCKED race-safety. 5 concurrent dequeues against 1 job
    // → exactly 1 lease total (others see locked row and skip via SKIP LOCKED).
    it('concurrent dequeue (5 workers, 1 job) → exactly 1 lease total', async () => {
      await backend.enqueue({ name: 'race-test', input: {} })
      const results = await Promise.all(
        Array.from({ length: 5 }, () => backend.dequeue({ batchSize: 1, lockSeconds: 30 })),
      )
      const totalLeases = results.reduce((sum, leases) => sum + leases.length, 0)
      expect(totalLeases).toBe(1)
    })

    // usetheokit/theokit#1011 — the one-job test above passed while 20 workers over 200 jobs leased
    // 162 to 178 of them more than once: the SELECT ... FOR UPDATE SKIP LOCKED and the UPDATE that
    // marked the lease ran as two autocommit statements, so the row lock ended before the lease was
    // written. A lock of 60 s outlives the run, so every extra lease is a double claim, not a retry.
    it('test_twenty_concurrent_workers_over_two_hundred_jobs_lease_each_job_exactly_once', async () => {
      const PoolCtor = ((await pgModulePromise)!.Pool ??
        (await pgModulePromise)!.default?.Pool) as new (config: unknown) => PgPoolLike
      const WORKERS = 20
      const JOBS = 200
      const wide = new PoolCtor({ connectionString: POSTGRES_URL, max: WORKERS })
      try {
        const racing = new PostgresJobBackend({ pool: wide, tableName: 'theokit_jobs_ci' })
        await Promise.all(Array.from({ length: WORKERS }, () => wide.query('SELECT 1')))
        for (let i = 0; i < JOBS; i++) await racing.enqueue({ name: 'race', input: { i } })

        const leasesPerJob = new Map<string, number>()
        const worker = async (): Promise<void> => {
          for (;;) {
            const leases = await racing.dequeue({ batchSize: 1, lockSeconds: 60 })
            if (leases.length === 0) return
            for (const l of leases) leasesPerJob.set(l.jobId, (leasesPerJob.get(l.jobId) ?? 0) + 1)
          }
        }
        await Promise.all(Array.from({ length: WORKERS }, worker))

        const leasedMoreThanOnce = [...leasesPerJob.values()].filter((n) => n > 1).length
        expect(leasedMoreThanOnce).toBe(0)
        expect(leasesPerJob.size).toBe(JOBS)
      } finally {
        await wide.end()
      }
    })

    // usetheokit/theokit#1012 — ack and nack filtered on `id` alone, so a worker whose lease had
    // expired deleted the job while the worker that re-leased it was still running it.
    const reLeasedAfterExpiry = async (): Promise<{ jobId: string; a: string; b: string }> => {
      const { jobId } = await backend.enqueue({ name: 'slow', input: {}, maxAttempts: 5 })
      const [a] = await backend.dequeue({ batchSize: 1, lockSeconds: 1 })
      await new Promise((r) => setTimeout(r, 1500))
      const [b] = await backend.dequeue({ batchSize: 1, lockSeconds: 60 })
      expect(b.jobId).toBe(jobId)
      return { jobId, a: a.leaseToken!, b: b.leaseToken! }
    }
    const rowsFor = async (jobId: string): Promise<number> =>
      (await pool.query<{ id: string }>(`SELECT id FROM theokit_jobs_ci WHERE id = $1`, [jobId]))
        .rows.length

    it('test_an_ack_with_an_expired_lease_token_is_refused_and_the_job_stays', async () => {
      const { jobId, a, b } = await reLeasedAfterExpiry()

      await expect(backend.ack(jobId, { leaseToken: a })).rejects.toBeInstanceOf(JobLeaseLostError)
      expect(await rowsFor(jobId)).toBe(1)

      await backend.ack(jobId, { leaseToken: b })
      expect(await rowsFor(jobId)).toBe(0)
    })

    it('test_a_nack_with_an_expired_lease_token_is_refused_and_the_current_lease_is_kept', async () => {
      const { jobId, a } = await reLeasedAfterExpiry()

      await expect(
        backend.nack(jobId, { error: 'late', nonRetryable: true, leaseToken: a }),
      ).rejects.toBeInstanceOf(JobLeaseLostError)
      expect(await rowsFor(jobId)).toBe(1)
      expect(await backend.dequeue({ batchSize: 1, lockSeconds: 60 })).toEqual([])
    })

    // usetheokit/theokit#1013 — the issue's repro: enqueued through the queue client, the job was
    // stored with max_attempts 1 and its first failure deleted it.
    it('test_a_job_enqueued_through_the_queue_client_is_retried_up_to_its_definition_max_attempts', async () => {
      let calls = 0
      const flaky = defineJob('flaky', {
        maxAttempts: 3,
        handler() {
          calls++
          throw new Error(`boom ${String(calls)}`)
        },
      })
      const outbox = createOutbox()
      const idP = createQueueClient(backend, outbox).enqueueWithId('flaky' as never, {} as never)
      await outbox.flush(createOutboxDispatcher(backend))
      const { jobId } = await idP
      const runner = createJobRunner(backend, [flaky])

      await runner.tick()
      expect(calls).toBe(1)
      const row = await pool.query<{ attempts: number }>(
        `SELECT attempts FROM theokit_jobs_ci WHERE id = $1`,
        [jobId],
      )
      expect(row.rows).toEqual([{ attempts: 1 }])
    })

    it('idempotency UNIQUE index — same (name, key) returns existing jobId', async () => {
      const a = await backend.enqueue({
        name: 'idem',
        input: {},
        idempotencyKey: 'dedup-1',
      })
      const b = await backend.enqueue({
        name: 'idem',
        input: {},
        idempotencyKey: 'dedup-1',
      })
      expect(b.jobId).toBe(a.jobId)
    })

    // usetheokit/theokit#1015 — enqueue checked the key with a SELECT and then ran a plain INSERT,
    // so racing callers on one key got a raw 23505 unique violation: about 9.5 of every 20 per key
    // once the pool was warm.
    it('test_twenty_concurrent_enqueues_with_one_idempotency_key_all_resolve_to_one_job', async () => {
      const PoolCtor = ((await pgModulePromise)!.Pool ??
        (await pgModulePromise)!.default?.Pool) as new (config: unknown) => PgPoolLike
      const wide = new PoolCtor({ connectionString: POSTGRES_URL, max: 20 })
      try {
        const racing = new PostgresJobBackend({ pool: wide, tableName: 'theokit_jobs_ci' })
        await Promise.all(Array.from({ length: 20 }, () => wide.query('SELECT 1')))
        const rejected: unknown[] = []
        for (let k = 0; k < 30; k++) {
          const results = await Promise.allSettled(
            Array.from({ length: 20 }, () =>
              racing.enqueue({ name: 'charge', input: {}, idempotencyKey: `order-${String(k)}` }),
            ),
          )
          for (const r of results) if (r.status === 'rejected') rejected.push(r.reason)
          const ids = new Set(
            results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.jobId] : [])),
          )
          expect(ids.size).toBeLessThanOrEqual(1)
        }
        expect(rejected).toEqual([])
        const rows = await pool.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM theokit_jobs_ci WHERE name = 'charge'`,
        )
        expect(rows.rows[0].n).toBe(30)
      } finally {
        await wide.end()
      }
    })

    it('test_idempotency_lookup_is_scoped_to_the_job_name_like_the_unique_index', async () => {
      const charge = await backend.enqueue({ name: 'charge', input: {}, idempotencyKey: 'k-1' })
      const email = await backend.enqueue({ name: 'email', input: {}, idempotencyKey: 'k-1' })
      expect(email.jobId).not.toBe(charge.jobId)

      expect(await backend.idempotency('k-1', 60, 'email')).toEqual({ jobId: email.jobId })
      expect(await backend.idempotency('k-1', 60, 'charge')).toEqual({ jobId: charge.jobId })
      expect(await backend.idempotency('k-1', 60, 'other')).toBeNull()
    })

    it('ack removes the row permanently', async () => {
      const { jobId } = await backend.enqueue({ name: 'ack-test', input: {} })
      await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
      await backend.ack(jobId)
      const r = await pool.query<{ id: string }>(`SELECT id FROM theokit_jobs_ci WHERE id = $1`, [
        jobId,
      ])
      expect(r.rows.length).toBe(0)
    })

    // usetheokit/theokit#1014 — a job that failed for good was DELETEd with its input and its
    // error, so an operator could not see what failed, why, or replay it.
    const failedRow = async (
      jobId: string,
    ): Promise<{ attempts: number; last_error: string | null; failed: boolean } | undefined> =>
      (
        await pool.query<{ attempts: number; last_error: string | null; failed: boolean }>(
          `SELECT attempts, last_error, failed_at IS NOT NULL AS failed FROM theokit_jobs_ci WHERE id = $1`,
          [jobId],
        )
      ).rows[0]

    it('test_a_non_retryable_nack_keeps_the_job_as_failed_with_its_error', async () => {
      const { jobId } = await backend.enqueue({ name: 'nr-test', input: { order: 7 } })
      const [lease] = await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
      await backend.nack(jobId, {
        error: 'fatal',
        nonRetryable: true,
        leaseToken: lease.leaseToken,
      })

      expect(await failedRow(jobId)).toEqual({ attempts: 1, last_error: 'fatal', failed: true })
      expect(await backend.dequeue({ batchSize: 1, lockSeconds: 30 })).toEqual([])
    })

    it('test_a_job_that_exhausts_its_attempts_stays_as_failed_with_the_last_error', async () => {
      const noDelay = new PostgresJobBackend({
        pool,
        tableName: 'theokit_jobs_ci',
        retryDelaySeconds: () => 0,
      })
      let calls = 0
      const flaky = defineJob('flaky', {
        maxAttempts: 3,
        handler() {
          calls++
          throw new Error(`boom ${String(calls)}`)
        },
      })
      const { jobId } = await noDelay.enqueue({ name: 'flaky', input: {}, maxAttempts: 3 })
      const runner = createJobRunner(noDelay, [flaky])

      for (let i = 0; i < 4; i++) await runner.tick()

      expect(calls).toBe(3)
      expect(await failedRow(jobId)).toEqual({ attempts: 3, last_error: 'boom 3', failed: true })
    })

    it('test_a_retried_job_waits_out_a_backoff_and_records_the_error', async () => {
      const { jobId } = await backend.enqueue({ name: 'retry', input: {}, maxAttempts: 3 })
      const [lease] = await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
      await backend.nack(jobId, { error: 'transient', leaseToken: lease.leaseToken })

      const r = await pool.query<{ delay: number; last_error: string; failed: boolean }>(
        `SELECT EXTRACT(EPOCH FROM available_at - NOW())::float AS delay, last_error,
                failed_at IS NOT NULL AS failed
           FROM theokit_jobs_ci WHERE id = $1`,
        [jobId],
      )
      expect(r.rows[0].last_error).toBe('transient')
      expect(r.rows[0].failed).toBe(false)
      expect(r.rows[0].delay).toBeGreaterThan(1)
      expect(await backend.dequeue({ batchSize: 1, lockSeconds: 30 })).toEqual([])
    })

    it('migrate() is idempotent (safe to re-run on every deploy)', async () => {
      await backend.migrate()
      await backend.migrate()
      const r = await pool.query<{ count: string }>(
        `SELECT count(*)::text as count FROM theokit_jobs_ci`,
      )
      expect(r.rows.length).toBe(1)
    })
  },
)
