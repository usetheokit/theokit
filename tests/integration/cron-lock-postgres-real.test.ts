import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPostgresCronLock } from '../../packages/theo/src/server/cron/cron-lock.js'
import { PostgresJobBackend } from '../../packages/theo/src/server/jobs/job-backend-postgres.js'
import type { PoolLike } from '../../packages/theo/src/server/storage/storage-types.js'

/**
 * The Postgres cron lock against a real database: N replicas, each with its own pool, race for the
 * same tick and exactly one wins (usetheokit/theokit#1016). An in-memory fake cannot show this; the
 * guarantee is the primary key on (name, scheduled_at) and `ON CONFLICT DO NOTHING`, which only
 * Postgres can exercise.
 */
const POSTGRES_URL = process.env.POSTGRES_URL

const pgModule = (await import(/* @vite-ignore */ 'pg' as string).catch(() => undefined)) as
  | { default?: { Pool: new (cfg: unknown) => PgPool }; Pool?: new (cfg: unknown) => PgPool }
  | undefined
type PgPool = PoolLike & { end(): Promise<void> }

const TABLE = 'theokit_cron_runs_ci'
const REPLICAS = 8

describe.skipIf(!POSTGRES_URL)('Postgres cron lock (real Postgres)', () => {
  const pools: PgPool[] = []

  beforeAll(async () => {
    const Pool = pgModule?.Pool ?? pgModule?.default?.Pool
    if (!Pool) throw new Error('POSTGRES_URL is set but `pg` does not resolve')
    for (let i = 0; i < REPLICAS; i++)
      pools.push(new Pool({ connectionString: POSTGRES_URL, max: 2 }))
    await pools[0].query(`DROP TABLE IF EXISTS ${TABLE}`)
  })

  afterAll(async () => {
    await pools[0]?.query(`DROP TABLE IF EXISTS ${TABLE}`)
    await Promise.all(pools.map((p) => p.end()))
  })

  it('one replica wins each tick, however many race for it', async () => {
    const locks = pools.map((pool) => createPostgresCronLock(pool, { tableName: TABLE }))
    for (let tick = 0; tick < 5; tick++) {
      const scheduledAt = new Date(Date.UTC(2026, 9, 30, 12, tick, 0))
      const results = await Promise.all(locks.map((l) => l.acquire('nightly-report', scheduledAt)))
      expect(results.filter(Boolean)).toHaveLength(1)
    }
  })

  it('replicas booting together all get an answer while racing to create the table', async () => {
    // Concurrent `CREATE TABLE IF NOT EXISTS` fails the loser with 23505 on the catalog; measured
    // 1 round in 30 before the lock treated that as "the table exists".
    for (let round = 0; round < 10; round++) {
      const table = `${TABLE}_boot_${String(round)}`
      await pools[0].query(`DROP TABLE IF EXISTS ${table}`)
      const locks = pools.map((pool) => createPostgresCronLock(pool, { tableName: table }))
      const at = new Date(Date.UTC(2026, 9, 30, 15, round, 0))
      const results = await Promise.all(locks.map((l) => l.acquire('boot', at)))
      expect(results.filter(Boolean)).toHaveLength(1)
      await pools[0].query(`DROP TABLE IF EXISTS ${table}`)
    }
  })

  it('a tick older than the retention window still has one winner', async () => {
    // Retention used to be measured from NOW(), so the winner deleted its own row and the next
    // replica inserted it again: two winners for one tick.
    const locks = pools.map((pool) => createPostgresCronLock(pool, { tableName: TABLE }))
    const old = new Date(Date.UTC(2020, 0, 1, 0, 0, 0))
    const results = await Promise.all(locks.map((l) => l.acquire('old-tick', old)))
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('different crons on the same tick do not block each other', async () => {
    const lock = createPostgresCronLock(pools[0], { tableName: TABLE })
    const at = new Date(Date.UTC(2026, 9, 30, 13, 0, 0))
    expect(await lock.acquire('a', at)).toBe(true)
    expect(await lock.acquire('b', at)).toBe(true)
  })

  it('PostgresJobBackend hands out a lock on its own pool', async () => {
    const backend = new PostgresJobBackend({ pool: pools[1] })
    const lock = backend.cronLock({ tableName: TABLE })
    const at = new Date(Date.UTC(2026, 9, 30, 14, 0, 0))
    expect(await lock.acquire('c', at)).toBe(true)
    expect(await createPostgresCronLock(pools[2], { tableName: TABLE }).acquire('c', at)).toBe(
      false,
    )
  })
})
