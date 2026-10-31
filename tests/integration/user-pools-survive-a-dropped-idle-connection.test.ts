import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createPostgresCronLock } from '../../packages/theo/src/server/cron/cron-lock.js'
import { PostgresJobBackend } from '../../packages/theo/src/server/jobs/job-backend-postgres.js'
import type { PoolLike } from '../../packages/theo/src/server/storage/storage-types.js'

/**
 * A `pg.Pool` the user builds and hands to `PostgresJobBackend` or `createPostgresCronLock`, and a
 * real Postgres terminating its idle connection.
 *
 * `pg-pool` re-emits the idle client's 57P01 as an `error` event on the pool. With no listener, Node
 * throws it and `theokit start` exits; since 0.76.0 the job worker keeps that pool busy, so the
 * window is always open (usetheokit/theokit#1037). Under vitest the throw surfaces as an unhandled
 * error and fails this file.
 *
 * Runs in the Postgres Jobs CI workflow, which sets POSTGRES_URL.
 */
const POSTGRES_URL = process.env.POSTGRES_URL

interface RealPool extends PoolLike {
  totalCount: number
  idleCount: number
  end: () => Promise<void>
}

const pgModule = (await import(/* @vite-ignore */ 'pg' as string).catch(() => undefined)) as
  | { default?: { Pool: new (cfg: unknown) => RealPool }; Pool?: new (cfg: unknown) => RealPool }
  | undefined

const TABLE = 'theokit_jobs_pool_error'
const CRON_TABLE = 'theokit_cron_runs_pool_error'

async function terminateIdleBackend(pool: RealPool, admin: RealPool): Promise<number> {
  const before = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
  const pid = before.rows[0].pid
  expect(pool.idleCount).toBe(1)
  await admin.query('SELECT pg_terminate_backend($1)', [pid])
  // The idle client learns about the termination asynchronously, on its socket.
  await vi.waitFor(
    () => {
      expect(pool.totalCount).toBe(0)
    },
    { timeout: 5000, interval: 25 },
  )
  return pid
}

function loggedEntries(log: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return log.mock.calls.flatMap((c) => {
    try {
      return [JSON.parse(String(c[0])) as Record<string, unknown>]
    } catch {
      return []
    }
  })
}

describe.skipIf(!POSTGRES_URL || !pgModule)(
  'pools handed to the job backend and the cron lock survive a dropped idle connection (#1037)',
  () => {
    const Pool = () => (pgModule!.Pool ?? pgModule!.default!.Pool)!
    let admin: RealPool
    const pools: RealPool[] = []

    beforeAll(() => {
      admin = new (Pool())({ connectionString: POSTGRES_URL, max: 1 })
    })

    afterAll(async () => {
      await admin.query(`DROP TABLE IF EXISTS ${TABLE}`)
      await admin.query(`DROP TABLE IF EXISTS ${CRON_TABLE}`)
      await Promise.all(pools.map((p) => p.end()))
      await admin.end()
    })

    it('test_a_job_backend_pool_logs_the_termination_and_the_next_dequeue_reconnects', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const pool = new (Pool())({ connectionString: POSTGRES_URL, max: 1 })
      pools.push(pool)
      const backend = new PostgresJobBackend({ pool, tableName: TABLE })
      await backend.migrate()

      const pid = await terminateIdleBackend(pool, admin)

      await backend.enqueue({ name: 'after-drop', input: {} })
      const leases = await backend.dequeue({ batchSize: 1 })
      expect(leases.map((l) => l.name)).toEqual(['after-drop'])
      const after = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      expect(after.rows[0].pid).not.toBe(pid)
      expect(loggedEntries(log)).toContainEqual(
        expect.objectContaining({ level: 'warn', component: 'theokit:jobs', code: '57P01' }),
      )
      log.mockRestore()
    })

    it('test_a_cron_lock_pool_logs_the_termination_and_the_next_acquire_reconnects', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      const pool = new (Pool())({ connectionString: POSTGRES_URL, max: 1 })
      pools.push(pool)
      const lock = createPostgresCronLock(pool, { tableName: CRON_TABLE })
      await lock.acquire('warmup', new Date(Date.UTC(2026, 9, 30, 9, 0, 0)))

      await terminateIdleBackend(pool, admin)

      await expect(
        lock.acquire('after-drop', new Date(Date.UTC(2026, 9, 30, 9, 1, 0))),
      ).resolves.toBe(true)
      expect(loggedEntries(log)).toContainEqual(
        expect.objectContaining({ level: 'warn', component: 'theokit:cron', code: '57P01' }),
      )
      log.mockRestore()
    })

    it('test_a_listener_the_user_attached_stays_the_only_one', () => {
      const pool = new (Pool())({ connectionString: POSTGRES_URL, max: 1 })
      pools.push(pool)
      const mine = (): void => {}
      ;(pool as unknown as { on: (e: string, l: () => void) => void }).on('error', mine)
      const backend = new PostgresJobBackend({ pool, tableName: TABLE })
      expect(backend.name).toBe('postgres')
      createPostgresCronLock(pool, { tableName: CRON_TABLE })
      const listeners = (pool as unknown as { listeners: (e: string) => unknown[] }).listeners(
        'error',
      )
      expect(listeners).toEqual([mine])
    })
  },
)
