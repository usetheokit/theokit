// A PostgreSQL-backed `JobStore`: the same contract as the file store, over a pool the caller owns.
// No driver is imported here; the caller passes a `pg` `Pool` or anything with `query`.
import { TheokitAgentError } from '@theokit/sdk/errors'

import { readJob, ScheduleStoreError, type JobStore, type ScheduledJob } from './job-store.js'

/** The one method the store needs; a `pg` `Pool` satisfies it. */
export interface SqlPool {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the issue's specified signature; `pg` rows are typed by the caller
  query<R = unknown>(sql: string, params?: readonly unknown[]): Promise<{ rows: R[] }>
}

/** `copyJobs` refused a target that already holds jobs. Not retryable: pass `force` or empty it. */
export class JobCopyError extends TheokitAgentError {
  override readonly name = 'JobCopyError'
  /** How many jobs the target already holds. */
  readonly existing: number

  constructor(existing: number) {
    super(
      `the target store already holds ${String(existing)} job(s); pass { force: true } to overwrite`,
      { code: 'SCHEDULE_COPY_TARGET_NOT_EMPTY', isRetryable: false },
    )
    this.existing = existing
  }
}

const TABLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/
const DEFAULT_TABLE = 'theokit_schedule_jobs'

// Stores that can take a whole batch in one statement (so one atomic write), found by `copyJobs`.
const bulkWriters = new WeakMap<JobStore, (jobs: ScheduledJob[]) => Promise<void>>()

/**
 * Open a job store over `pool`: creates the table if absent and loads every row (each validated like
 * a file-store job; a bad row raises {@link ScheduleStoreError} naming the table and job id). Reads
 * are served from memory loaded at open, so replicas do not see each other's later writes until they
 * reopen. Writes run one after another, and memory changes only after the database accepted the write.
 */
export async function createPostgresJobStore(
  pool: SqlPool,
  options: { table?: string } = {},
): Promise<JobStore> {
  const table = options.table ?? DEFAULT_TABLE
  if (!TABLE_NAME.test(table)) {
    throw new ScheduleStoreError(table, `invalid table name (must match ${String(TABLE_NAME)})`)
  }
  const upsert = `INSERT INTO ${table} (id, job) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET job = EXCLUDED.job`

  const jobs = new Map<string, ScheduledJob>()
  let rows: { id: string; job: unknown }[]
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS ${table} (id text PRIMARY KEY, job jsonb NOT NULL)`,
    )
    rows = (await pool.query<{ id: string; job: unknown }>(`SELECT id, job FROM ${table}`)).rows
  } catch (error) {
    throw new ScheduleStoreError(
      table,
      `database unreachable (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    )
  }
  for (const row of rows) {
    const job = readJob(table, row.job, `job ${row.id}`)
    jobs.set(job.id, job)
  }

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
        await pool.query(upsert, [job.id, JSON.stringify(job)])
        jobs.set(job.id, job)
      }),
    remove: (id) =>
      serialized(async () => {
        await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id])
        return jobs.delete(id)
      }),
    setPreviousOutput: (id, text) =>
      serialized(async () => {
        const held = jobs.get(id)
        if (held === undefined) return false
        const next = { ...held, previousOutput: text }
        await pool.query(upsert, [id, JSON.stringify(next)])
        jobs.set(id, next)
        return true
      }),
  }

  bulkWriters.set(store, (batch) =>
    serialized(async () => {
      if (batch.length === 0) return
      // One INSERT ... VALUES (...), (...) statement is atomic: all rows land or none do.
      const values = batch.map((_, i) => `($${String(i * 2 + 1)}, $${String(i * 2 + 2)}::jsonb)`)
      await pool.query(
        `INSERT INTO ${table} (id, job) VALUES ${values.join(', ')} ON CONFLICT (id) DO UPDATE SET job = EXCLUDED.job`,
        batch.flatMap((job) => [job.id, JSON.stringify(job)]),
      )
      for (const job of batch) jobs.set(job.id, job)
    }),
  )
  return store
}

/**
 * Copy every job of `from` into `to` and resolve the count. A non-empty target raises
 * {@link JobCopyError} unless `force`. Into a PostgreSQL store the copy is one atomic statement;
 * into another store it is a `put` per job, so a failing `put` leaves a partial copy.
 */
export async function copyJobs(
  from: JobStore,
  to: JobStore,
  options: { force: boolean },
): Promise<number> {
  const existing = to.list().length
  if (existing > 0 && !options.force) throw new JobCopyError(existing)
  const batch = from.list()
  const bulk = bulkWriters.get(to)
  if (bulk !== undefined) await bulk(batch)
  else for (const job of batch) await to.put(job)
  return batch.length
}
