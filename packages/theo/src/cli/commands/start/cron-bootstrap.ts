import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { CronManifest } from '../../../server/cron/cron-manifest.js'
import type { CronDefinition } from '../../../server/cron/cron-types.js'

/**
 * Reads the cron manifest `theokit build` writes and re-loads each handler so
 * `theokit start` can drive the in-process scheduler.
 *
 * The build prints "Cron → in-process scheduler (theokit start)" for
 * `target: node`, but nothing on the serving side ever read `dist/crons.json`
 * — the crons were declared, validated, written, and then never ran
 * (theokit#324).
 *
 * The manifest names WHICH files hold a cron; the definition itself is taken
 * from the module, which is the source `defineCron` produced. Trusting the
 * manifest's copy of the schedule would let a stale build silently run a cron
 * on the wrong cadence.
 */
export async function loadCronDefinitions(
  manifestPath: string,
  projectRoot: string,
  loadModule: (filePath: string) => unknown,
): Promise<CronDefinition[]> {
  if (!existsSync(manifestPath)) return []

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as CronManifest
  const definitions: CronDefinition[] = []

  for (const entry of manifest.crons) {
    const filePath = resolve(projectRoot, entry.filePath)
    const mod = (await loadModule(filePath)) as { default?: unknown }
    const exported = mod.default

    if (!isCronDefinition(exported)) {
      throw new Error(
        `Cron "${entry.name}" declared in "${entry.filePath}" is missing a valid default export. ` +
          'Expected `export default defineCron(name, { schedule, handler })`. ' +
          'Re-run `theokit build` if the file changed since the last build.',
      )
    }

    definitions.push(exported)
  }

  return definitions
}

function isCronDefinition(value: unknown): value is CronDefinition {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.schedule === 'string' &&
    typeof candidate.handler === 'function'
  )
}
