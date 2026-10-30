import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  __resetSingletonForTests,
  getStorageManager,
} from '../../packages/theo/src/server/storage/storage-manager.js'
import type { PoolLike } from '../../packages/theo/src/server/storage/storage-types.js'

/**
 * A real `pg.Pool` from `usePostgres`, and a real Postgres terminating its idle connection.
 *
 * Without an `error` listener on the pool, `pg-pool` re-emits the idle client's
 * `terminating connection due to administrator command` (57P01) as an `error` event and Node
 * throws it as an uncaught exception, which exits `theokit start` (usetheokit/theokit#1019). Under
 * vitest the same throw surfaces as an unhandled error and fails this file.
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

describe.skipIf(!POSTGRES_URL || !pgModule)(
  'usePostgres survives Postgres dropping an idle pooled connection (#1019)',
  () => {
    let pool: RealPool
    let admin: RealPool

    beforeAll(() => {
      const Pool = (pgModule!.Pool ?? pgModule!.default!.Pool)!
      __resetSingletonForTests()
      const url = new URL(POSTGRES_URL!)
      const manager = getStorageManager()
      manager.configure({
        servers: {
          local: {
            host: url.hostname,
            port: Number(url.port || 5432),
            user: decodeURIComponent(url.username),
            password: decodeURIComponent(url.password),
          },
        },
        databases: { main: { server: 'local', database: url.pathname.slice(1) } },
      })
      pool = manager.usePostgres(
        'main',
        () => new Pool({ connectionString: POSTGRES_URL, max: 2 }),
      ) as RealPool
      admin = new Pool({ connectionString: POSTGRES_URL, max: 1 })
    })

    afterAll(async () => {
      await getStorageManager().dispose()
      __resetSingletonForTests()
      await admin.end()
    })

    it('test_pg_terminate_backend_on_the_idle_client_is_logged_and_the_next_query_reconnects', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
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

      const after = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
      expect(after.rows[0].pid).not.toBe(pid)
      const entries = log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
      expect(entries).toContainEqual(
        expect.objectContaining({ level: 'warn', database: 'main', code: '57P01' }),
      )
      log.mockRestore()
    })
  },
)
