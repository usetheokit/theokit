import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { TheoConfig } from '../../../config/schema.js'
import { jobBackendFromConfig } from '../../../server/jobs/job-backend-from-config.js'
import type { JobBackend } from '../../../server/jobs/job-backend.js'
import type { JobManifest } from '../../../server/jobs/job-manifest.js'
import { createJobRunner } from '../../../server/jobs/job-runner.js'
import type { JobDefinition } from '../../../server/jobs/job-types.js'
import { createJobWorker, type JobWorker } from '../../../server/jobs/job-worker.js'

/**
 * Reads the job manifest `theokit build` writes and re-loads each definition, the jobs twin of
 * `loadCronDefinitions`. The manifest names WHICH files hold a job; the definition comes from the
 * module, so a stale build cannot run a handler the source no longer has.
 *
 * Before usetheokit/theokit#1010 nothing on the serving side read `jobs.json`.
 */
export async function loadJobDefinitions(
  manifestPath: string,
  projectRoot: string,
  loadModule: (filePath: string) => unknown,
): Promise<JobDefinition[]> {
  if (!existsSync(manifestPath)) return []
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as JobManifest
  return loadJobModules(
    manifest.jobs.map((entry) => resolve(projectRoot, entry.filePath)),
    loadModule,
  )
}

/** Import each file and take its `defineJob` default export, refusing a file without one. */
export async function loadJobModules(
  filePaths: readonly string[],
  loadModule: (filePath: string) => unknown,
): Promise<JobDefinition[]> {
  const definitions: JobDefinition[] = []
  for (const filePath of filePaths) {
    const mod = (await loadModule(filePath)) as { default?: unknown }
    if (!isJobDefinition(mod.default)) {
      throw new Error(
        `"${filePath}" is listed as a job but has no valid default export. ` +
          "Expected `export default defineJob(name, { handler })` from 'theokit/server/jobs'. " +
          'Re-run `theokit build` if the file changed since the last build.',
      )
    }
    definitions.push(mod.default)
  }
  return definitions
}

function isJobDefinition(value: unknown): value is JobDefinition {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.handler === 'function' &&
    typeof candidate.maxAttempts === 'number'
  )
}

export interface JobWorkerBootstrap {
  /** The running worker, or `undefined` when none was started (see `summary`). */
  readonly worker: JobWorker | undefined
  /** One line for the boot log saying what happens to the declared jobs, or `undefined` if none. */
  readonly summary: string | undefined
}

/**
 * Start the in-process job worker when there is something to run and somewhere to run it from.
 *
 * - no declared jobs: no worker. A worker with no definitions would lease other processes' jobs
 *   and fail them as "No job definition".
 * - jobs but no `jobs.backend`: no worker, and the summary says the jobs cannot run.
 * - `jobs.worker.enabled: false`: no worker, said in the summary, so a web-only process is visibly
 *   one.
 */
export function startJobWorker(
  config: Pick<TheoConfig, 'jobs'>,
  definitions: readonly JobDefinition[],
): JobWorkerBootstrap {
  if (definitions.length === 0) return { worker: undefined, summary: undefined }
  const declared = `Jobs: ${String(definitions.length)} declared`
  const backend: JobBackend | undefined = jobBackendFromConfig(config)
  if (backend === undefined) {
    return {
      worker: undefined,
      summary:
        `${declared}, NOT running: theo.config.ts sets no jobs.backend, so ctx.queue is absent ` +
        'and nothing can enqueue or run them.',
    }
  }
  const options = config.jobs?.worker
  if (options?.enabled === false) {
    return {
      worker: undefined,
      summary: `${declared}, worker disabled (jobs.worker.enabled: false); another process must run them.`,
    }
  }
  const worker = createJobWorker(createJobRunner(backend, definitions), {
    pollIntervalMs: options?.pollIntervalMs,
    batchSize: options?.batchSize,
    lockSeconds: options?.lockSeconds,
  })
  worker.start()
  return {
    worker,
    summary: `${declared}, worker polling the ${backend.name} backend in-process`,
  }
}
