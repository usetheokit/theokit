// OC-121 — the scheduled jobs in PostgreSQL, on the TheoKit storage manager, when `THEOCLAW_DATABASE`
// holds a DSN. Files stay the default. There is no fallback: a DSN that cannot be reached refuses the start.
import type { JobStore, ScheduledJob } from '@theokit/agents/tools'
import { getStorageManager } from 'theokit/server/storage'
import type { PoolLike } from 'theokit/server/storage'

const TABLE = 'theoclaw_scheduled_jobs'
const DATABASE_NAME = 'theoclaw'

/** The DSN when `THEOCLAW_DATABASE` selects PostgreSQL; `undefined` for the file store. Anything else is refused. */
export function readDatabaseDsn(env: Readonly<Record<string, string | undefined>>): string | undefined {
  const value = env.THEOCLAW_DATABASE?.trim()
  if (value === undefined || value === '' || value === 'files' || value === 'sqlite') return undefined
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    throw new Error('THEOCLAW_DATABASE must be a postgres:// or postgresql:// URL, or unset for files')
  }
  return value
}

export interface PostgresScheduleStore {
  readonly store: JobStore
  close(): Promise<void>
}

/** Builds the pool from a DSN; a seam for tests. */
export type PoolFromDsn = (dsn: string) => Promise<PoolLike> | PoolLike

async function defaultPool(dsn: string): Promise<PoolLike> {
  const { default: pg } = await import('pg')
  return new pg.Pool({ connectionString: dsn }) as unknown as PoolLike
}

/**
 * Open the job store in PostgreSQL: the pool comes from the TheoKit `StorageManager`, the table is
 * created if absent, and the rows are read once so the store's reads stay synchronous. Mutations
 * write the row first and change the held state only once it is saved.
 */
export async function openPostgresScheduleStore(
  dsn: string,
  makePool: PoolFromDsn = defaultPool,
): Promise<PostgresScheduleStore> {
  const url = new URL(dsn)
  const manager = getStorageManager()
  manager.configure({
    servers: { [DATABASE_NAME]: { host: url.hostname, user: decodeURIComponent(url.username), password: '' } },
    databases: { [DATABASE_NAME]: { server: DATABASE_NAME, database: url.pathname.replace(/^\//, '') } },
  })
  const built = await makePool(dsn)
  const pool = manager.usePostgres(DATABASE_NAME, () => built)
  let jobs = new Map<string, ScheduledJob>()
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${TABLE} (id text PRIMARY KEY, job jsonb NOT NULL, created_at bigint NOT NULL)`,
    )
    const { rows } = await pool.query<{ job: ScheduledJob | string }>(`SELECT job FROM ${TABLE} ORDER BY created_at, id`)
    for (const row of rows) {
      const job = typeof row.job === 'string' ? (JSON.parse(row.job) as ScheduledJob) : row.job
      jobs.set(job.id, job)
    }
  } catch (error) {
    await pool.end?.()
    throw new Error(`THEOCLAW_DATABASE: PostgreSQL is unreachable or refused the schedule table (${(error as Error).message})`)
  }
  const save = (job: ScheduledJob): Promise<unknown> =>
    pool.query(
      `INSERT INTO ${TABLE} (id, job, created_at) VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (id) DO UPDATE SET job = EXCLUDED.job`,
      [job.id, JSON.stringify(job), job.createdAt],
    )
  let chain: Promise<unknown> = Promise.resolve()
  const serialized = <T>(mutation: () => Promise<T>): Promise<T> => {
    const done = chain.then(mutation)
    chain = done.catch(() => undefined)
    return done
  }
  const store: JobStore = {
    list: () => [...jobs.values()],
    get: (id) => jobs.get(id),
    put: (job) =>
      serialized(async () => {
        await save(job)
        jobs = new Map(jobs).set(job.id, job)
      }),
    remove: (id) =>
      serialized(async () => {
        if (!jobs.has(id)) return false
        await pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id])
        jobs = new Map(jobs)
        jobs.delete(id)
        return true
      }),
    setPreviousOutput: (id, text) =>
      serialized(async () => {
        const held = jobs.get(id)
        if (held === undefined) return false
        const next = { ...held, previousOutput: text }
        await save(next)
        jobs = new Map(jobs).set(id, next)
        return true
      }),
  }
  let closed = false
  return {
    store,
    close: async () => {
      if (closed) return
      closed = true
      await manager.dispose()
    },
  }
}
