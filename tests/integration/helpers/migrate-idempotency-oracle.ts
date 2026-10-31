import { expect } from 'vitest'

import type {
  PoolLike,
  PostgresJobBackend,
} from '../../../packages/theo/src/server/jobs/job-backend-postgres.js'

export interface MigrateIdempotencyOracleInput {
  /** An already migrated backend: the oracle checks what a re-run does to its schema. */
  backend: PostgresJobBackend
  pool: PoolLike
  /** The backend's table; passed by the test, never taken from input. */
  table: string
}

const KEYED_JOB = {
  name: 'migrate-idempotency',
  input: {},
  idempotencyKey: 'migrate-idempotency',
} as const

/**
 * The B-668 oracle: `migrate()` is safe to re-run on every deploy.
 *
 * A keyed job is enqueued before two more `migrate()` runs. The row must survive them, and the
 * same name and key must still return the first job's id with one row in the table, which only
 * holds while the unique (name, idempotency_key) index exists. Counting the rows of
 * `SELECT count(*)` proved nothing: an aggregate always returns one row.
 *
 * The caller passes a backend it already migrated once, as a deploy that runs migrate() again,
 * and an empty table: the one-row check counts every row in it.
 */
export async function assertMigrateIsIdempotent({
  backend,
  pool,
  table,
}: MigrateIdempotencyOracleInput): Promise<void> {
  const { jobId } = await backend.enqueue(KEYED_JOB)

  await backend.migrate()
  await backend.migrate()

  const kept = await pool.query<{ id: string }>(`SELECT id FROM ${table} WHERE id = $1`, [jobId])
  expect(kept.rows, 'the row enqueued before the re-run survives it').toHaveLength(1)

  const again = await backend.enqueue(KEYED_JOB)
  expect(again.jobId, 'the idempotency index still deduplicates after the re-run').toBe(jobId)

  const all = await pool.query<{ id: string }>(`SELECT id FROM ${table}`)
  expect(all.rows, `${table} holds exactly the one keyed row after the re-run`).toHaveLength(1)
}
