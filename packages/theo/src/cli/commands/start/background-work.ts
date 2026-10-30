import { resolve } from 'node:path'

import type { TheoConfig } from '../../../config/schema.js'
import { cronLockFromConfig } from '../../../server/cron/cron-lock-from-config.js'
import { createCronScheduler } from '../../../server/cron/cron-runtime-node.js'

import { loadCronDefinitions } from './cron-bootstrap.js'
import { loadJobDefinitions, startJobWorker } from './job-bootstrap.js'

/** What `theokit start` runs beside the HTTP server: the cron scheduler and the job worker. */
export interface BackgroundWork {
  /** Boot-log lines, one per kind of work that was declared. */
  readonly summaries: readonly string[]
  /** Stop scheduling and polling; resolves after the job in progress, if any, has finished. */
  stop(): Promise<void>
}

/**
 * Load `.theokit/crons.json` and `.theokit/jobs.json` and start what they declare.
 *
 * Crons (theokit#324) and jobs (usetheokit/theokit#1010) are both build artifacts the node target
 * announces as "run by `theokit start`", and until #1010 only the crons were.
 */
export async function startBackgroundWork(
  config: Pick<TheoConfig, 'jobs' | 'cron'>,
  distDir: string,
  projectRoot: string,
  loadModule: (filePath: string) => unknown,
): Promise<BackgroundWork> {
  const summaries: string[] = []
  const cronDefinitions = await loadCronDefinitions(
    resolve(distDir, 'crons.json'),
    projectRoot,
    loadModule,
  )
  let scheduler: ReturnType<typeof createCronScheduler> | undefined
  if (cronDefinitions.length > 0) {
    // #1016 — each replica runs this scheduler; the lock decides which one runs a tick.
    const { lock, description } = cronLockFromConfig(config)
    scheduler = createCronScheduler(cronDefinitions, { lock })
    scheduler.start()
    summaries.push(`Crons: ${String(cronDefinitions.length)} scheduled in-process, ${description}`)
  }

  const jobDefinitions = await loadJobDefinitions(
    resolve(distDir, 'jobs.json'),
    projectRoot,
    loadModule,
  )
  const jobs = startJobWorker(config, jobDefinitions)
  if (jobs.summary !== undefined) summaries.push(jobs.summary)

  return {
    summaries,
    async stop() {
      scheduler?.stop()
      if (jobs.worker !== undefined) {
        await jobs.worker.stop()
        console.log('  [theokit] jobs worker stopped')
      }
    },
  }
}
