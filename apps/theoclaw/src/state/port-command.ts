import type { Writable } from 'node:stream'

import { createJobStore } from '@theokit/agents/tools'

import { UsageError } from '../cli-args.js'
import { loadConfiguration } from '../config-file.js'
import { TheoClawConfigError } from '../control-plane/errors.js'
import { resolveInstance } from '../instance.js'
import {
  databaseSecrets,
  openPostgresJobStore,
  portJobs,
  readDatabaseSetting,
  type DatabaseDeps,
} from '../scheduler/postgres-job-store.js'
import { scheduleFile } from '../scheduler/scheduler-wiring.js'

export interface StatePortIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly stdout: Writable
  readonly stderr: Writable
}

const USAGE_TEXT = 'theoclaw state: expected port --to <postgres url> [--force]'

/**
 * `theoclaw state port --to <url> [--force]` (#1640): copies every store that has a schema (the
 * scheduled jobs) from the current engine to PostgreSQL and prints the rows copied per store. The
 * source is never changed. Exit 0, or 1 with the refusal on stderr.
 */
export async function statePortCommand(
  args: readonly string[],
  io: StatePortIo,
  deps: DatabaseDeps = {},
): Promise<number> {
  const [verb, ...rest] = args
  if (verb !== 'port') throw new UsageError(USAGE_TEXT)
  let to: string | undefined
  let force = false
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--force') force = true
    else if (rest[i] === '--to' && to === undefined) to = rest[++i]
    else throw new UsageError(USAGE_TEXT)
  }
  if (to === undefined || to.startsWith('-')) throw new UsageError(USAGE_TEXT)

  const env: NodeJS.ProcessEnv = { ...io.env }
  loadConfiguration(env, io.homeDir)
  const target = readDatabaseSetting({ THEOCLAW_DATABASE: to })
  if (target.engine !== 'postgres') {
    throw new UsageError('theoclaw state port: --to expects a postgres:// URL')
  }
  const secrets = [...databaseSecrets(target)]
  const source = readDatabaseSetting(env)
  secrets.push(...databaseSecrets(source))
  const scrub = (text: string): string => secrets.reduce((out, secret) => out.split(secret).join('***'), text)

  try {
    let jobs
    if (source.engine === 'postgres') {
      const opened = await openPostgresJobStore(source.dsn, deps)
      try {
        jobs = opened.store.list()
      } finally {
        await opened.close()
      }
    } else {
      const workspace =
        env.THEOCLAW_WORKSPACE?.trim() || resolveInstance(env, { homeDir: io.homeDir }).workspace
      if (workspace === undefined || workspace === '') {
        throw new TheoClawConfigError('THEOCLAW_WORKSPACE must be set to the directory TheoClaw keeps its state in', {
          variable: 'THEOCLAW_WORKSPACE',
        })
      }
      jobs = createJobStore(scheduleFile(workspace)).list()
    }
    const copied = await portJobs(target.dsn, jobs, { force }, deps)
    io.stdout.write(`schedules: ${copied} rows copied\n`)
    return 0
  } catch (error) {
    if (error instanceof UsageError || error instanceof TheoClawConfigError) throw error
    io.stderr.write(`theoclaw state port: ${scrub((error as Error).message)}\n`)
    return 1
  }
}
