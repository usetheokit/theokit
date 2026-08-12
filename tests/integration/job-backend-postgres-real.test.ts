import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

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

    it('ack removes the row permanently', async () => {
      const { jobId } = await backend.enqueue({ name: 'ack-test', input: {} })
      await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
      await backend.ack(jobId)
      const r = await pool.query<{ id: string }>(`SELECT id FROM theokit_jobs_ci WHERE id = $1`, [
        jobId,
      ])
      expect(r.rows.length).toBe(0)
    })

    it('nack with nonRetryable=true deletes row', async () => {
      const { jobId } = await backend.enqueue({ name: 'nr-test', input: {} })
      await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
      await backend.nack(jobId, { error: 'fatal', nonRetryable: true })
      const r = await pool.query<{ id: string }>(`SELECT id FROM theokit_jobs_ci WHERE id = $1`, [
        jobId,
      ])
      expect(r.rows.length).toBe(0)
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
