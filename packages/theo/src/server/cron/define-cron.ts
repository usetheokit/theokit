import type { CronDefinition, CronOptions } from './cron-types.js'
import { validateCronSchedule } from './cron-validate.js'

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

/** What {@link isValidCronName} requires, in words, for an error message. */
export const CRON_NAME_RULE =
  'Must be 1-64 chars, lowercase alphanumeric + hyphen, starting with [a-z0-9].'

/** Whether `defineCron` accepts `name`. The generator asks this before writing a cron. */
export function isValidCronName(name: string): boolean {
  return typeof name === 'string' && NAME_RE.test(name)
}

function validateName(name: string): void {
  if (!isValidCronName(name)) {
    throw new Error(`defineCron: invalid name "${name}". ${CRON_NAME_RULE}`)
  }
}

/**
 * Declare a time-triggered handler. Pure identity helper — no
 * registration side effect; the build-time scanner (T1.3) discovers
 * definitions by walking `server/crons/` and emits a manifest the
 * adapters translate at deploy.
 *
 * @example
 * ```ts
 * // server/crons/morning-summary.ts
 * export default defineCron('morning-summary', {
 *   schedule: '0 9 * * *',  // 09:00 UTC
 *   async handler({ traceId, scheduledAt, signal }) {
 *     // ...
 *   },
 * })
 * ```
 */
export function defineCron(name: string, options: CronOptions): CronDefinition {
  validateName(name)
  validateCronSchedule(options.schedule)
  return {
    name,
    schedule: options.schedule,
    handler: options.handler,
    concurrency: options.concurrency ?? 'forbid',
  }
}
