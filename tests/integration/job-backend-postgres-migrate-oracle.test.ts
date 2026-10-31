import { describe, it, expect, beforeEach } from 'vitest'
// pg-mem is an in-memory Postgres: these cases run on every `vitest run`, inside the required CI
// check, where the real-Postgres file only runs in its own non-required job.
import { DataType, newDb } from 'pg-mem'

import {
  PostgresJobBackend,
  type PoolLike,
  type PostgresJobBackendOptions,
} from '../../packages/theo/src/server/jobs/job-backend-postgres.js'
import { assertMigrateIsIdempotent } from './helpers/migrate-idempotency-oracle.js'

// B-668 — the real-Postgres test 'migrate() is idempotent' (job-backend-postgres-real.test.ts)
// calls the same oracle. Here it runs against the current backend and against two mutants, each a
// subclass whose migrate() is not idempotent, so no production line is edited to prove the oracle
// can fail.

const TABLE = 'theokit_jobs'

/**
 * Every migrate() empties the table, so each deploy loses every row. Written as DELETE, not DROP
 * TABLE: pg-mem keeps a dropped table's primary-key index, so a DROP-then-CREATE mutant throws by
 * itself and would read as a kill the oracle never made.
 */
class WipesRows extends PostgresJobBackend {
  readonly #ownPool: PoolLike
  constructor(opts: PostgresJobBackendOptions) {
    super(opts)
    this.#ownPool = opts.pool
  }
  override async migrate(): Promise<void> {
    await super.migrate()
    await this.#ownPool.query(`DELETE FROM ${TABLE}`)
  }
}

/** The second and later migrate() drop the unique idempotency index. */
class DropsIndexOnRerun extends PostgresJobBackend {
  readonly #ownPool: PoolLike
  #runs = 0
  constructor(opts: PostgresJobBackendOptions) {
    super(opts)
    this.#ownPool = opts.pool
  }
  override async migrate(): Promise<void> {
    await super.migrate()
    if (++this.#runs > 1) {
      await this.#ownPool.query(`DROP INDEX IF EXISTS ${TABLE}_idempotency_key_idx`)
    }
  }
}

let pool: PoolLike

beforeEach(() => {
  const db = newDb({ noAstCoverageCheck: true } as never)
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.text,
    implementation: () => Math.random().toString(16).slice(2),
  })
  pool = new (db.adapters.createPg() as { Pool: new () => PoolLike }).Pool()
})

/** Migrates once, as the real suite's `beforeAll` does, before the oracle re-runs it. */
async function migrated<T extends PostgresJobBackend>(backend: T): Promise<T> {
  await backend.migrate()
  return backend
}

const insertKeyed = (id: string): Promise<unknown> =>
  pool.query(
    `INSERT INTO ${TABLE} (id, name, input, idempotency_key) VALUES ($1, 'n', '{}', 'k')`,
    [id],
  )

describe('B-668 — the migrate idempotency oracle rejects a migrate() that is not idempotent', () => {
  it('test_the_oracle_passes_on_the_current_backend', async () => {
    const backend = await migrated(new PostgresJobBackend({ pool, tableName: TABLE }))
    await assertMigrateIsIdempotent({ backend, pool, table: TABLE })
  })

  it('test_the_oracle_rejects_a_migrate_that_deletes_every_row', async () => {
    const backend = await migrated(new WipesRows({ pool, tableName: TABLE }))
    await expect(assertMigrateIsIdempotent({ backend, pool, table: TABLE })).rejects.toThrow(
      /survives/,
    )
  })

  it('test_the_oracle_rejects_a_rerun_that_drops_the_idempotency_index', async () => {
    const backend = await migrated(new DropsIndexOnRerun({ pool, tableName: TABLE }))
    await expect(assertMigrateIsIdempotent({ backend, pool, table: TABLE })).rejects.toThrow(
      /deduplicates/,
    )
  })

  it('checkpoint_the_index_mutant_removes_the_unique_index', async () => {
    const backend = await migrated(new DropsIndexOnRerun({ pool, tableName: TABLE }))
    await insertKeyed('a')
    await expect(insertKeyed('b'), 'the first migrate creates the unique index').rejects.toThrow()
    await backend.migrate()
    await insertKeyed('c')
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM ${TABLE}`)
    expect(rows, 'the second migrate dropped the unique index').toHaveLength(2)
  })
})
