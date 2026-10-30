import type { TheoConfig } from '../../config/schema.js'

import type { JobBackend } from './job-backend.js'

/**
 * The configured `jobs.backend`, typed. `theoConfigSchema` already refused a value without the
 * `enqueue`/`dequeue`/`ack`/`nack` methods, so the narrowing here restates a checked fact.
 *
 * The config module cannot import `server/` (the module DAG in `.dependency-cruiser.cjs`), which is
 * why the schema types the field as a plain object and this is where it becomes a `JobBackend`.
 */
export function jobBackendFromConfig(config: Pick<TheoConfig, 'jobs'>): JobBackend | undefined {
  return config.jobs?.backend as JobBackend | undefined
}
