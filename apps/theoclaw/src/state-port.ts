// #1640 — `theoclaw state port --to postgres://...`: copy the stores that have a PostgreSQL schema
// from the files to the target. Today that is the scheduled jobs; sessions stay in their files.
import { loadConfiguration } from './config-file.js'
import { resolveInstance } from './instance.js'
import { loadScheduleStore } from './scheduler/scheduler-wiring.js'
import {
  type DatabaseDeps,
  portJobs,
  readDatabaseSetting,
  StatePortRefusal,
} from './scheduler/postgres-job-store.js'

export { StatePortRefusal }

export interface PortedStore {
  readonly store: string
  readonly rows: number
}

export async function portState(
  source: NodeJS.ProcessEnv,
  homeDir: string,
  to: string,
  force: boolean,
  deps: DatabaseDeps = {},
): Promise<PortedStore[]> {
  const env: NodeJS.ProcessEnv = { ...source }
  loadConfiguration(env, homeDir)
  if (readDatabaseSetting(env).engine === 'postgres')
    throw new StatePortRefusal('THEOCLAW_DATABASE already selects PostgreSQL: there is no file state to port from')
  const target = readDatabaseSetting({ THEOCLAW_DATABASE: to })
  if (target.engine !== 'postgres') throw new StatePortRefusal('--to must be a postgres:// URL')
  const instance = resolveInstance(env, { homeDir })
  const workspace = (instance.workspace ?? env.THEOCLAW_WORKSPACE ?? '').trim()
  if (workspace === '') throw new StatePortRefusal('THEOCLAW_WORKSPACE is unset: there is no state to port')
  const jobs = loadScheduleStore(workspace).list()
  const rows = await portJobs(target.dsn, jobs, { force }, deps)
  return [{ store: 'schedules', rows }]
}
