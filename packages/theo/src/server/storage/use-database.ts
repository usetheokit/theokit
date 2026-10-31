/**
 * `useDatabase(name, connector)` — wraps `db0.createDatabase(connector)` via
 * `StorageManager.useStorage<T>` for caching.
 *
 * `db0` is an OPTIONAL peer dependency. Apps that don't use db0 pay zero bundle
 * cost; calling `useDatabase` without `db0` installed throws an actionable error.
 *
 * **For Postgres: prefer `usePostgres(dbName, factory)`** — returns `pg.Pool`
 * directly which integrates better with Drizzle / raw SQL.
 *
 * Lifecycle: db0 connectors don't share a unified close API. Users SHOULD
 * register a dispose hook manually if cleanup matters (EC-9 documented):
 *   ```ts
 *   const db = await useDatabase('main', sqlite({...}))
 *   getStorageManager().register({ name: 'db:main', dispose: () => db.exec('...') })
 *   ```
 *
 * Reserved cache key prefix: `__db0:` — do NOT use this prefix in
 * `manager.useStorage<T>(name)` to avoid collision (EC-8 documented).
 *
 * @example libSQL / Turso
 *   import libsql from 'db0/connectors/libsql-core'
 *   const db = await useDatabase('main', libsql({ url: process.env.TURSO_URL }))
 *
 * @example SQLite (better-sqlite3)
 *   import sqlite from 'db0/connectors/better-sqlite3'
 *   const db = await useDatabase('main', sqlite({ name: 'app.db' }))
 */
import { createLogger } from '../observability/logger.js'

import { listenForErrorsUnlessHandled } from './error-listener.js'
import { getStorageManager } from './storage-manager.js'

interface Db0Module {
  createDatabase: (connector: unknown) => Db0Database
}

export interface Db0Database {
  exec: (sql: string) => Promise<unknown>
  prepare: (sql: string) => unknown
  sql: (strings: TemplateStringsArray, ...args: unknown[]) => Promise<unknown>
  /** The connector's dialect (`'postgresql'`, `'sqlite'`, ...). */
  readonly dialect?: string
  /** The driver client underneath (db0's `getInstance`). */
  getInstance?: () => Promise<unknown>
}

const databaseLogger = createLogger({ context: { component: 'theokit:storage' } })

/**
 * db0's Postgres connector opens one `pg.Client` and attaches no `error` listener. When Postgres
 * drops that connection (a restart, a failover, `pg_terminate_backend`), the client emits `error`
 * and Node exits the process on an `error` event with no listener. So for a Postgres database the
 * client is opened here and given a listener that logs a structured warning. db0 keeps the closed
 * client, so later queries on this database fail until the process restarts; `usePostgres` gives a
 * pool that reconnects.
 */
async function keepDb0ClientErrorsFromExitingTheProcess(
  db: Db0Database,
  name: string,
): Promise<void> {
  if (db.dialect !== 'postgresql' || typeof db.getInstance !== 'function') return
  const client = await db.getInstance()
  if (typeof client !== 'object' || client === null) return
  listenForErrorsUnlessHandled(client, (err) => {
    databaseLogger.warn(
      'postgres connection error; db0 does not reconnect, so queries on this database fail until restart (usePostgres reconnects)',
      { database: name, code: err.code, error: err.message },
    )
  })
}

/**
 * EC-5 — heuristic to detect a connector factory that wasn't invoked.
 *
 * `db0` connectors are factories: `sqlite({...})` returns a `Connector`.
 * If the user passes `sqlite` (the factory itself) instead of `sqlite({...})`
 * (the invoked Connector), `db0.createDatabase` fails with a cryptic message.
 *
 * A connector is an object (with methods like `exec`, `prepare`). A factory
 * is a function with declared parameters (arity ≥ 1, since connectors take
 * an options object). We throw an actionable error in the factory case.
 */
function detectUninvokedFactory(connector: unknown): string | null {
  if (typeof connector === 'function') {
    const fn = connector as { length?: number; name?: string }
    if ((fn.length ?? 0) > 0) {
      const name = fn.name !== undefined && fn.name !== '' ? fn.name : 'connector'
      return (
        `useDatabase: connector argument looks like an un-invoked factory (function with ${String(fn.length)} parameter(s)). ` +
        `Did you forget to call the factory? Pass \`${name}({...})\` not \`${name}\`. ` +
        `Example: useDatabase('main', sqlite({ name: ':memory:' }))`
      )
    }
  }
  return null
}

export async function useDatabase(name: string, connector: unknown): Promise<Db0Database> {
  const factoryError = detectUninvokedFactory(connector)
  if (factoryError !== null) throw new Error(factoryError)

  const mod = (await import('db0').catch(() => null)) as Db0Module | null
  if (mod === null) {
    throw new Error("useDatabase requires the 'db0' package. Install via: pnpm add db0")
  }
  const manager = getStorageManager()
  const db = manager.useStorage<Db0Database>(`__db0:${name}`, () => mod.createDatabase(connector))
  await keepDb0ClientErrorsFromExitingTheProcess(db, name)
  return db
}
