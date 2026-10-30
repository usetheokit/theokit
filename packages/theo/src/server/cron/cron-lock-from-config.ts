import type { TheoConfig } from '../../config/schema.js'

import type { CronLock } from './cron-lock.js'

export interface ResolvedCronLock {
  readonly lock: CronLock | undefined
  /** How the boot log describes it, after "Crons: N scheduled in-process, ". */
  readonly description: string
}

/**
 * The cron lock `theokit start` uses, from `theo.config.ts` (usetheokit/theokit#1016):
 *
 * 1. `cron.lock: false`: none, by choice.
 * 2. `cron.lock: <CronLock>`: that one.
 * 3. a `jobs.backend` that offers `cronLock()` (`PostgresJobBackend` does): a lock on its pool, since
 *    replicas sharing a job database already share somewhere to agree.
 * 4. otherwise none, and the description says each replica fires every cron.
 *
 * Duck-typed rather than `instanceof PostgresJobBackend`: the backend in the config comes from the
 * library build and this code from the CLI build, which carry separate copies of the class.
 */
export function cronLockFromConfig(config: Pick<TheoConfig, 'cron' | 'jobs'>): ResolvedCronLock {
  const declared = config.cron?.lock
  if (declared === false) {
    return { lock: undefined, description: 'no distributed lock (cron.lock: false)' }
  }
  if (declared !== undefined) {
    return {
      lock: declared as CronLock,
      description: 'one firing per tick across processes (cron.lock)',
    }
  }
  const backend = config.jobs?.backend as { cronLock?: unknown; name?: unknown } | undefined
  if (backend !== undefined && typeof backend.cronLock === 'function') {
    const lock = (backend.cronLock as () => CronLock).call(backend)
    return {
      lock,
      description: `one firing per tick across processes (lock on the ${String(backend.name)} jobs backend)`,
    }
  }
  return {
    lock: undefined,
    description:
      'no distributed lock: every process running theokit start fires each cron. ' +
      'Run one replica, or set cron.lock (a PostgresJobBackend in jobs.backend provides one)',
  }
}
