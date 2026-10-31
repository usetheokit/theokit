import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  __resetSingletonForTests,
  getStorageManager,
} from '../../packages/theo/src/server/storage/storage-manager.js'
import { useDatabase } from '../../packages/theo/src/server/storage/use-database.js'

/**
 * `useDatabase(name, postgresql({ url }))` with db0's Postgres connector, and a real Postgres
 * terminating its connection.
 *
 * db0 opens one `pg.Client` and attaches no `error` listener, so the client's 57P01 is an `error`
 * event nobody handles and Node exits the process. Under vitest the throw surfaces as an unhandled
 * error and fails this file.
 *
 * Runs in the Postgres Jobs CI workflow, which sets POSTGRES_URL.
 */
const POSTGRES_URL = process.env.POSTGRES_URL

interface AdminClient {
  connect: () => Promise<void>
  query: (sql: string, params?: unknown[]) => Promise<unknown>
  end: () => Promise<void>
}

const pgModule = (await import(/* @vite-ignore */ 'pg' as string).catch(() => undefined)) as
  | {
      default?: { Client: new (cfg: unknown) => AdminClient }
      Client?: new (cfg: unknown) => AdminClient
    }
  | undefined
const connectorModule = (await import(
  /* @vite-ignore */ 'db0/connectors/postgresql' as string
).catch(() => undefined)) as { default: (opts: { url: string }) => unknown } | undefined

describe.skipIf(!POSTGRES_URL || !pgModule || !connectorModule)(
  'useDatabase with the db0 Postgres connector survives a dropped connection',
  () => {
    afterAll(async () => {
      await getStorageManager().dispose()
      __resetSingletonForTests()
    })

    it('test_pg_terminate_backend_on_the_db0_client_is_logged_and_the_process_stays_up', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      __resetSingletonForTests()
      const db = await useDatabase('db0-pg', connectorModule!.default({ url: POSTGRES_URL! }))
      const row = (await (
        db.prepare('SELECT pg_backend_pid() AS pid') as { get: () => Promise<unknown> }
      ).get()) as { pid: number }

      const Client = (pgModule!.Client ?? pgModule!.default!.Client)!
      const admin = new Client({ connectionString: POSTGRES_URL })
      await admin.connect()
      await admin.query('SELECT pg_terminate_backend($1)', [row.pid])
      await admin.end()

      await vi.waitFor(
        () => {
          const entries = log.mock.calls.flatMap((c) => {
            try {
              return [JSON.parse(String(c[0])) as Record<string, unknown>]
            } catch {
              return []
            }
          })
          expect(entries).toContainEqual(
            expect.objectContaining({ level: 'warn', database: 'db0-pg', code: '57P01' }),
          )
        },
        { timeout: 5000, interval: 25 },
      )
      log.mockRestore()
    })
  },
)
