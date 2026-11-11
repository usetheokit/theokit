// #1565 — the scheduled jobs kept in PostgreSQL instead of `schedules.json`, on the TheoKit
// storage manager. Reads are served from the loaded rows, as the file store's are; every write goes
// to the table first and enters memory only once the database took it. There is no fallback to the
// file: a database that cannot be reached refuses the start.
import type { JobStore, ScheduledJob } from '@theokit/agents/tools'
import { getStorageManager, type StorageManager } from 'theokit/server/storage'
import type { PoolLike } from 'theokit/server/storage'

/** `THEOCLAW_DATABASE`: unset, `sqlite` or `files` keep the files; a `postgres://` URL selects PostgreSQL. */
export type DatabaseSetting =
  | { readonly engine: 'files' }
  | { readonly engine: 'postgres'; readonly dsn: string }

export function readDatabaseSetting(
  env: Readonly<Record<string, string | undefined>>,
): DatabaseSetting {
  const raw = env.THEOCLAW_DATABASE?.trim()
  if (raw === undefined || raw === '' || raw === 'sqlite' || raw === 'files')
    return { engine: 'files' }
  if (/^postgres(ql)?:\/\//i.test(raw)) return { engine: 'postgres', dsn: raw }
  throw new Error('THEOCLAW_DATABASE must be sqlite, files, or a postgres:// URL')
}

const TABLE = 'theoclaw_schedules'

/** A pool that loads the optional `pg` driver on first use, so files-only installs need nothing. */
function lazyPgPool(config: Record<string, unknown>): PoolLike {
  let pool: Promise<PoolLike> | undefined
  const load = (): Promise<PoolLike> => {
    pool ??= import(/* @vite-ignore */ 'pg' as string).then(
      (mod: {
        default?: { Pool: new (c: unknown) => PoolLike }
        Pool?: new (c: unknown) => PoolLike
      }) => {
        const Pool = mod.Pool ?? mod.default?.Pool
        if (Pool === undefined) throw new Error('the pg driver has no Pool')
        return new Pool(config)
      },
      () => {
        throw new Error('THEOCLAW_DATABASE needs the "pg" package: install it next to theoclaw')
      },
    )
    return pool
  }
  return {
    query: async (sql, params) => (await load()).query(sql, params),
    end: async () => {
      if (pool !== undefined) await (await pool).end?.()
    },
  }
}

export interface OpenedScheduleStore {
  readonly store: JobStore
  close(): Promise<void>
}

export async function openPostgresJobStore(
  dsn: string,
  makePool: (config: Record<string, unknown>) => PoolLike = lazyPgPool,
  manager: StorageManager = getStorageManager(),
): Promise<OpenedScheduleStore> {
  const url = new URL(dsn)
  const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || 'postgres'
  const sslmode = url.searchParams.get('sslmode')
  manager.configure({
    servers: {
      theoclaw: {
        host: url.hostname,
        port: url.port === '' ? 5432 : Number(url.port),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      },
    },
    databases: { theoclaw: { server: 'theoclaw', database } },
  })
  const pool = manager.usePostgres('theoclaw', (server, db) =>
    makePool({
      host: server.host,
      port: server.port,
      user: server.user,
      password: server.password,
      database: db.database,
      ...(sslmode !== null && sslmode !== 'disable' ? { ssl: true } : {}),
    }),
  )
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (id text PRIMARY KEY, job jsonb NOT NULL)`,
    )
    const { rows } = await pool.query<{ job: ScheduledJob | string }>(`SELECT job FROM ${TABLE}`)
    const jobs = new Map<string, ScheduledJob>()
    for (const row of rows) {
      const job = typeof row.job === 'string' ? (JSON.parse(row.job) as ScheduledJob) : row.job
      jobs.set(job.id, job)
    }
    return { store: storeOver(pool, jobs), close: () => pool.end?.() ?? Promise.resolve() }
  } catch (error) {
    await pool.end?.().catch(() => undefined)
    throw new Error(`the schedule database is unreachable: ${(error as Error).message}`)
  }
}

function storeOver(pool: PoolLike, jobs: Map<string, ScheduledJob>): JobStore {
  let chain: Promise<unknown> = Promise.resolve()
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const done = chain.then(work)
    chain = done.catch(() => undefined)
    return done
  }
  const save = (job: ScheduledJob): Promise<unknown> =>
    pool.query(
      `INSERT INTO ${TABLE} (id, job) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET job = EXCLUDED.job`,
      [job.id, JSON.stringify(job)],
    )
  return {
    list: () => [...jobs.values()],
    get: (id) => jobs.get(id),
    put: (job) =>
      serialized(async () => {
        await save(job)
        jobs.set(job.id, job)
      }),
    remove: (id) =>
      serialized(async () => {
        if (!jobs.has(id)) return false
        await pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id])
        return jobs.delete(id)
      }),
    setPreviousOutput: (id, text) =>
      serialized(async () => {
        const held = jobs.get(id)
        if (held === undefined) return false
        const next = { ...held, previousOutput: text }
        await save(next)
        jobs.set(id, next)
        return true
      }),
  }
}
