import { describe, expect, it } from 'vitest'

import { createPostgresCronLock } from '../../packages/theo/src/server/cron/cron-lock.js'
import { PostgresJobBackend } from '../../packages/theo/src/server/jobs/job-backend-postgres.js'
import type { PoolLike } from '../../packages/theo/src/server/storage/storage-types.js'

/**
 * What the Postgres cron lock sends and how it reads the answers (usetheokit/theokit#1016). The
 * guarantee itself, one winner per tick across real connections, is in
 * `tests/integration/cron-lock-postgres-real.test.ts`, which needs a database; this file runs
 * everywhere and pins the statements and the error handling around them.
 */
interface Call {
  sql: string
  params: unknown[] | undefined
}

function fakePool(
  answer: (sql: string, call: number) => { rows: Record<string, unknown>[] } | Error,
): PoolLike & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    query: ((sql: string, params?: unknown[]) => {
      calls.push({ sql, params })
      const result = answer(sql, calls.length)
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
    }) as PoolLike['query'],
  }
}

const won = { rows: [{ name: 'nightly' }] }
const lost = { rows: [] }
const at = new Date('2026-10-30T12:00:00.000Z')

function pgError(code: string): Error {
  return Object.assign(new Error(`pg ${code}`), { code })
}

describe('createPostgresCronLock', () => {
  it('creates the table once, inserts the tick and prunes relative to the tick when it wins', async () => {
    const pool = fakePool((sql) => (sql.startsWith('INSERT') ? won : lost))
    const lock = createPostgresCronLock(pool, { tableName: 'my_runs', retentionDays: 3 })

    expect(await lock.acquire('nightly', at)).toBe(true)
    expect(await lock.acquire('nightly', new Date('2026-10-31T12:00:00.000Z'))).toBe(true)

    const creates = pool.calls.filter((c) => c.sql.includes('CREATE TABLE IF NOT EXISTS my_runs'))
    expect(creates).toHaveLength(1)
    const insert = pool.calls.find((c) => c.sql.startsWith('INSERT'))
    expect(insert?.sql).toContain('ON CONFLICT DO NOTHING')
    expect(insert?.params).toEqual(['nightly', at.toISOString()])
    const prune = pool.calls.find((c) => c.sql.startsWith('DELETE'))
    expect(prune?.params).toEqual(['nightly', at.toISOString(), 3])
  })

  it('returns false and prunes nothing when another replica took the tick', async () => {
    const pool = fakePool(() => lost)
    expect(await createPostgresCronLock(pool).acquire('nightly', at)).toBe(false)
    expect(pool.calls.some((c) => c.sql.startsWith('DELETE'))).toBe(false)
    expect(pool.calls[0].sql).toContain('theokit_cron_runs')
  })

  it.each(['23505', '42P07', '42710'])(
    'treats %s from a concurrent CREATE as "the table exists"',
    async (code) => {
      const pool = fakePool((sql) => (sql.startsWith('CREATE') ? pgError(code) : won))
      expect(await createPostgresCronLock(pool).acquire('nightly', at)).toBe(true)
    },
  )

  it('rethrows any other CREATE failure and tries the CREATE again on the next tick', async () => {
    const pool = fakePool((sql, n) =>
      sql.startsWith('CREATE') && n === 1 ? pgError('28P01') : won,
    )
    const lock = createPostgresCronLock(pool)
    await expect(lock.acquire('nightly', at)).rejects.toThrow('pg 28P01')
    expect(await lock.acquire('nightly', at)).toBe(true)
    expect(pool.calls.filter((c) => c.sql.startsWith('CREATE'))).toHaveLength(2)
  })

  it('refuses a table name that would be interpolated unsafely', () => {
    const pool = fakePool(() => lost)
    expect(() => createPostgresCronLock(pool, { tableName: 'runs; DROP TABLE x' })).toThrow(
      /Invalid cron lock table name/,
    )
  })
})

describe('PostgresJobBackend.cronLock', () => {
  it('builds the lock on the backend pool', async () => {
    const pool = fakePool((sql) => (sql.startsWith('INSERT') ? won : lost))
    const lock = new PostgresJobBackend({ pool }).cronLock({ tableName: 'shared_runs' })
    expect(await lock.acquire('nightly', at)).toBe(true)
    expect(pool.calls.some((c) => c.sql.includes('CREATE TABLE IF NOT EXISTS shared_runs'))).toBe(
      true,
    )
  })
})
