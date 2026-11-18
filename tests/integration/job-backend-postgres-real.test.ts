import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

import { defineJob } from '../../packages/theo/src/server/jobs/define-job.js'
import { JobLeaseLostError } from '../../packages/theo/src/server/jobs/job-backend.js'
import { createJobRunner } from '../../packages/theo/src/server/jobs/job-runner.js'
import { PostgresJobBackend } from '../../packages/theo/src/server/jobs/job-backend-postgres.js'
import {
  RETRY_IMMEDIATELY,
  assertQueuedJobIsRetriedToItsDefinitionMaxAttempts,
} from './helpers/queued-job-retry-oracle.js'
import { assertMigrateIsIdempotent } from './helpers/migrate-idempotency-oracle.js'

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
  connect: () => Promise<PgClientLike>
}
interface PgClientLike {
  query<R>(sql: string, params?: unknown[]): Promise<PgQueryResult<R>>
  release: () => void
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

    // usetheokit/theokit#1132 — a handler keeps its lease while it makes progress.
    it('test_extendLease_pushes_the_lock_forward_so_no_other_worker_can_take_the_job', async () => {
      const { jobId } = await backend.enqueue({ name: 'long', input: {}, maxAttempts: 3 })
      const [lease] = await backend.dequeue({ batchSize: 1, lockSeconds: 1 })

      const until = await backend.extendLease(jobId, {
        leaseToken: lease.leaseToken!,
        lockSeconds: 60,
      })
      expect(until.getTime()).toBeGreaterThan(Date.now() + 50_000)

      await new Promise((r) => setTimeout(r, 1500)) // past the first, 1 second, lock
      expect(await backend.dequeue({ batchSize: 1, lockSeconds: 60 })).toEqual([])
      await backend.ack(jobId, { leaseToken: lease.leaseToken })
      expect(await rowsFor(jobId)).toBe(0)
    })

    it('test_extendLease_with_an_expired_lease_token_is_refused_and_leaves_the_new_lock', async () => {
      const { jobId, a, b } = await reLeasedAfterExpiry()

      await expect(
        backend.extendLease(jobId, { leaseToken: a, lockSeconds: 999 }),
      ).rejects.toMatchObject({
        code: 'JOB_LEASE_LOST',
        operation: 'extend',
      })
      // The current holder's 60 second lock is not replaced by the stale 999 second one.
      const locked = await pool.query<{ secs: number }>(
        `SELECT EXTRACT(EPOCH FROM (locked_until - NOW()))::float AS secs FROM theokit_jobs_ci WHERE id = $1`,
        [jobId],
      )
      expect(locked.rows[0].secs).toBeLessThan(61)
      await backend.ack(jobId, { leaseToken: b })
    })

    it('test_extendLease_of_a_job_that_has_failed_for_good_is_refused', async () => {
      const { jobId } = await backend.enqueue({ name: 'long', input: {} })
      const [lease] = await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
      await backend.nack(jobId, { error: 'boom', nonRetryable: true, leaseToken: lease.leaseToken })

      await expect(
        backend.extendLease(jobId, { leaseToken: lease.leaseToken!, lockSeconds: 30 }),
      ).rejects.toBeInstanceOf(JobLeaseLostError)
    })

    // usetheokit/theokit#1013 — the issue's repro: enqueued through the queue client, the job was
    // stored with max_attempts 1 and its first failure deleted it.
    // B-666 — since #1014 a final failure keeps its row, so `attempts = 1` after one tick no longer
    // tells a retry from a final failure; the shared oracle asserts pending after attempt 1 and
    // failed only after attempt 3, and job-backend-postgres-retry-oracle.test.ts proves it can fail.
    it('test_a_job_enqueued_through_the_queue_client_is_retried_up_to_its_definition_max_attempts', async () => {
      const noDelay = new PostgresJobBackend({
        pool,
        tableName: 'theokit_jobs_ci',
        ...RETRY_IMMEDIATELY,
      })
      await assertQueuedJobIsRetriedToItsDefinitionMaxAttempts({
        backend: noDelay,
        pool,
        table: 'theokit_jobs_ci',
      })
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
      // B-668 — the shared oracle (also run against mutants on pg-mem), plus the catalog check
      // only real Postgres can answer: both indexes still exist after the re-runs.
      await assertMigrateIsIdempotent({ backend, pool, table: 'theokit_jobs_ci' })
      const names = ['theokit_jobs_ci_available_at_idx', 'theokit_jobs_ci_idempotency_key_idx']
      const idx = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'theokit_jobs_ci' AND indexname = ANY($1)`,
        [names],
      )
      expect(
        idx.rows.map((r) => r.indexname).sort((a, b) => a.localeCompare(b)),
        'both theokit_jobs_ci indexes still exist in pg_indexes after the re-runs',
      ).toEqual(names)
    })

    // usetheokit/theokit#1077 — a job enqueued through the caller's transaction commits and rolls
    // back with the row it is about, so a route cannot commit a task and lose the job processing it.
    describe('enqueueInTransaction', () => {
      const TASKS = 'theokit_jobs_ci_tasks'

      beforeAll(async () => {
        await pool.query(`CREATE TABLE IF NOT EXISTS ${TASKS} (id SERIAL PRIMARY KEY, title TEXT)`)
      })
      afterAll(async () => {
        await pool.query(`DROP TABLE IF EXISTS ${TASKS}`)
      })
      beforeEach(async () => {
        await pool.query(`DELETE FROM ${TASKS}`)
      })

      async function inTransaction(
        work: (client: PgClientLike) => Promise<void>,
        outcome: 'COMMIT' | 'ROLLBACK',
      ): Promise<void> {
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          await work(client)
          await client.query(outcome)
        } catch (err) {
          await client.query('ROLLBACK')
          throw err
        } finally {
          client.release()
        }
      }

      it('test_a_job_enqueued_in_a_committed_transaction_is_leased_with_its_row_committed', async () => {
        let jobId = ''
        await inTransaction(async (client) => {
          const task = await client.query<{ id: number }>(
            `INSERT INTO ${TASKS} (title) VALUES ('t') RETURNING id`,
          )
          const enqueued = await backend.enqueueInTransaction(client, {
            name: 'process-task',
            input: { taskId: task.rows[0].id },
          })
          jobId = enqueued.jobId
          const outside = await pool.query(`SELECT id FROM theokit_jobs_ci WHERE id = $1`, [jobId])
          expect(outside.rows, 'the job is invisible to workers before the commit').toHaveLength(0)
        }, 'COMMIT')

        const tasks = await pool.query<{ id: number }>(`SELECT id FROM ${TASKS}`)
        const leases = await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
        expect(leases.map((l) => l.jobId)).toEqual([jobId])
        expect(leases[0].input).toEqual({ taskId: tasks.rows[0].id })
      })

      it('test_a_job_enqueued_in_a_rolled_back_transaction_never_exists', async () => {
        await inTransaction(async (client) => {
          await client.query(`INSERT INTO ${TASKS} (title) VALUES ('t')`)
          await backend.enqueueInTransaction(client, { name: 'process-task', input: {} })
        }, 'ROLLBACK')

        expect((await pool.query(`SELECT id FROM ${TASKS}`)).rows).toHaveLength(0)
        expect((await pool.query(`SELECT id FROM theokit_jobs_ci`)).rows).toHaveLength(0)
      })

      it('test_a_failed_enqueue_aborts_the_row_it_was_written_with', async () => {
        const broken = new PostgresJobBackend({ pool, tableName: 'theokit_jobs_ci_missing' })
        await expect(
          inTransaction(async (client) => {
            await client.query(`INSERT INTO ${TASKS} (title) VALUES ('t')`)
            await broken.enqueueInTransaction(client, { name: 'process-task', input: {} })
          }, 'COMMIT'),
        ).rejects.toThrow(/theokit_jobs_ci_missing/)

        expect((await pool.query(`SELECT id FROM ${TASKS}`)).rows).toHaveLength(0)
      })
    })

    // usetheokit/theokit#1072 — `theokit start` now runs migrate() at boot, so every replica runs it
    // at the same moment. Concurrent `CREATE TABLE IF NOT EXISTS` on a fresh table fails in Postgres
    // with a unique violation on pg_type: 36 of 80 calls (8 at a time, 10 fresh tables) failed
    // before migrate() retried the race.
    it('test_replicas_migrating_a_fresh_table_at_the_same_time_all_succeed', async () => {
      const PoolCtor = ((await pgModulePromise)!.Pool ??
        (await pgModulePromise)!.default?.Pool) as new (config: unknown) => PgPoolLike
      const REPLICAS = 8
      const wide = new PoolCtor({ connectionString: POSTGRES_URL, max: REPLICAS })
      const table = `theokit_jobs_race_${String(Date.now())}`
      try {
        const outcomes = await Promise.allSettled(
          Array.from({ length: REPLICAS }, () =>
            new PostgresJobBackend({ pool: wide, tableName: table }).migrate(),
          ),
        )
        const failures = outcomes.flatMap((o) =>
          o.status === 'rejected' ? [(o.reason as Error).message] : [],
        )
        expect(failures).toEqual([])
      } finally {
        await wide.query(`DROP TABLE IF EXISTS ${table}`)
        await wide.end()
      }
    })
  },
)
