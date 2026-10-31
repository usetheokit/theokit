import { createLogger } from '../observability/logger.js'
import { keepPoolErrorsFromExitingTheProcess } from '../storage/error-listener.js'
import type { PoolLike } from '../storage/storage-types.js'

/**
 * Decides which process runs a cron tick when several run the scheduler.
 *
 * `theokit start` schedules every cron in every process, so N replicas used to fire each tick N
 * times (usetheokit/theokit#1016). With a lock, each process asks before running the handler and
 * only the one that gets `true` runs it. `scheduledAt` is the tick's computed time, the same value
 * in every replica, which is what makes it a key they can agree on.
 */
export interface CronLock {
  /** `true` exactly once per `(name, scheduledAt)` across every process sharing the lock. */
  acquire(name: string, scheduledAt: Date): Promise<boolean>
}

export interface PostgresCronLockOptions {
  /** Table holding one row per fired tick (default `theokit_cron_runs`). Created on first use. */
  tableName?: string
  /** Rows older than this are deleted when the same cron fires again. Default 7 days. */
  retentionDays?: number
}

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/
const cronLockLogger = createLogger({ context: { component: 'theokit:cron' } })

/**
 * A `CronLock` on a shared Postgres: one row per fired tick, keyed by `(name, scheduled_at)`. The
 * replica whose `INSERT ... ON CONFLICT DO NOTHING` inserts the row runs the tick; every other one
 * gets no row back and skips it. A row rather than `pg_try_advisory_lock` because the lock has to
 * outlive the statement: a replica whose timer fires a few milliseconds late must still see that the
 * tick was taken, and an advisory lock released after a fast handler would let it run again.
 *
 * Each row is also a record of when the tick fired and nothing else; rows past `retentionDays` are
 * removed as the cron keeps firing.
 *
 * When `pool` has an event API and no `error` listener, one is attached that logs a structured
 * warning instead of letting a dropped idle connection exit the process (usetheokit/theokit#1037).
 */
export function createPostgresCronLock(
  pool: PoolLike,
  options: PostgresCronLockOptions = {},
): CronLock {
  const table = options.tableName ?? 'theokit_cron_runs'
  if (!TABLE_NAME.test(table)) {
    throw new Error(
      `Invalid cron lock table name "${table}": use lowercase letters, digits and underscores.`,
    )
  }
  keepPoolErrorsFromExitingTheProcess(pool, cronLockLogger, { table })
  const retentionDays = options.retentionDays ?? 7
  let ready: Promise<unknown> | undefined

  const ensureTable = (): Promise<unknown> => {
    ready ??= pool
      .query(
        `CREATE TABLE IF NOT EXISTS ${table} (
          name TEXT NOT NULL,
          scheduled_at TIMESTAMPTZ NOT NULL,
          fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (name, scheduled_at)
        )`,
      )
      .catch((err: unknown) => {
        // Replicas booting together race on `CREATE TABLE IF NOT EXISTS`, and the loser gets a
        // unique violation on the catalog (23505), "relation exists" (42P07) or "type exists"
        // (42710) although the table now exists. Measured with 8 concurrent pools.
        const code = (err as { code?: unknown }).code
        if (code === '23505' || code === '42P07' || code === '42710') return
        // Any other failure is retried on the next tick instead of being cached forever.
        ready = undefined
        throw err
      })
    return ready
  }

  return {
    async acquire(name, scheduledAt) {
      await ensureTable()
      const inserted = await pool.query<{ name: string }>(
        `INSERT INTO ${table} (name, scheduled_at) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING name`,
        [name, scheduledAt.toISOString()],
      )
      const won = inserted.rows.length === 1
      if (won) {
        // Relative to the tick, never to NOW(): a row deleted while its tick can still be raced for
        // would let a second replica insert it again and fire the same tick twice.
        await pool.query(
          `DELETE FROM ${table}
           WHERE name = $1 AND scheduled_at < $2::timestamptz - make_interval(days => $3)`,
          [name, scheduledAt.toISOString(), retentionDays],
        )
      }
      return won
    },
  }
}
