// #1565 — the scheduled jobs kept in PostgreSQL instead of `schedules.json`, on the TheoKit
// storage manager. Reads are served from the loaded rows, as the file store's are; every write goes
// to the table first and enters memory only once the database took it. There is no fallback to the
// file: a database that cannot be reached refuses the start.
import type { JobStore, ScheduledJob } from '@theokit/agents/tools'
import { getStorageManager, type StorageManager } from 'theokit/server/storage'
import type { PoolLike } from 'theokit/server/storage'

import { TheoClawConfigError } from '../control-plane/errors.js'

/** `THEOCLAW_DATABASE`: unset, `sqlite` or `files` keep the files; a `postgres://` URL selects PostgreSQL. */
export type DatabaseSetting =
  | { readonly engine: 'files' }
  | { readonly engine: 'postgres'; readonly dsn: string }

export function readDatabaseSetting(env: Readonly<Record<string, string | undefined>>): DatabaseSetting {
  const raw = env.THEOCLAW_DATABASE?.trim()
  if (raw === undefined || raw === '' || raw === 'sqlite' || raw === 'files') return { engine: 'files' }
  if (/^postgres(ql)?:\/\//i.test(raw)) {
    try {
      new URL(raw)
    } catch {
      throw new TheoClawConfigError('THEOCLAW_DATABASE is not a valid postgres:// URL', { variable: 'THEOCLAW_DATABASE' })
    }
    return { engine: 'postgres', dsn: raw }
  }
  throw new TheoClawConfigError('THEOCLAW_DATABASE must be sqlite, files, or a postgres:// URL', { variable: 'THEOCLAW_DATABASE' })
}

/** The values of the setting that must never reach a log line: the whole URL and its password. */
export function databaseSecrets(setting: DatabaseSetting): string[] {
  if (setting.engine !== 'postgres') return []
  const password = new URL(setting.dsn).password
  return [setting.dsn, ...(password === '' ? [] : [password, decodeURIComponent(password)])]
}

/** Test seams: the pool the store talks to and the storage manager that owns it. */
export interface DatabaseDeps {
  readonly makePool?: (config: Record<string, unknown>) => PoolLike
  readonly manager?: StorageManager
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

function openPool(dsn: string, deps: DatabaseDeps): PoolLike {
  const makePool = deps.makePool ?? lazyPgPool
  const manager = deps.manager ?? getStorageManager()
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
  return manager.usePostgres('theoclaw', (server, db) =>
    makePool({
      host: server.host,
      port: server.port,
      user: server.user,
      password: server.password,
      database: db.database,
      ...(sslmode !== null && sslmode !== 'disable' ? { ssl: true } : {}),
    }),
  )
}

export async function openPostgresJobStore(
  dsn: string,
  deps: DatabaseDeps = {},
): Promise<OpenedScheduleStore> {
  const pool = openPool(dsn, deps)
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

/** A target that already holds theoclaw rows and was not forced. */
export class StatePortRefusal extends Error {}

/** #1640 — copy jobs into the table; refuses a table that has rows unless `force`. Never touches the source. */
export async function portJobs(
  dsn: string,
  jobs: readonly ScheduledJob[],
  options: { readonly force: boolean },
  deps: DatabaseDeps = {},
): Promise<number> {
  const pool = openPool(dsn, deps)
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (id text PRIMARY KEY, job jsonb NOT NULL)`)
    const { rows } = await pool.query<{ id: string }>(`SELECT id FROM ${TABLE}`)
    if (rows.length > 0 && !options.force) {
      throw new StatePortRefusal(
        `the target already holds ${rows.length} theoclaw schedule rows; pass --force to copy over them`,
      )
    }
    for (const job of jobs) {
      await pool.query(
        `INSERT INTO ${TABLE} (id, job) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET job = EXCLUDED.job`,
        [job.id, JSON.stringify(job)],
      )
    }
    return jobs.length
  } finally {
    await pool.end?.().catch(() => undefined)
  }
}
