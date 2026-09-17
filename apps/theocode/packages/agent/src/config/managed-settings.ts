import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Where an administrator deploys `managed-settings.json`, per platform.
 *
 * #737 — the reference defines this as enterprise settings a user CANNOT override. The paths are its
 * paths, deliberately: an organisation that already deploys the file for the tool it was written for
 * must not have to deploy a second copy somewhere else for this one to honour it. Reading the same
 * file is the whole value; inventing our own location would mean the policy applies to one tool and
 * not the other, which is the state this closes.
 *
 * All three are consulted rather than switching on `process.platform`. A WSL process sees the Linux
 * path and can also see the Windows one through `/mnt/c`, and a machine with neither loses nothing by
 * the extra `existsSync`.
 */
const MANAGED_PATHS: readonly string[] = [
  '/Library/Application Support/ClaudeCode/managed-settings.json',
  '/etc/claude-code/managed-settings.json',
  join('C:\\', 'ProgramData', 'ClaudeCode', 'managed-settings.json'),
]

/**
 * The enterprise policy, or `null` when no administrator deployed one.
 *
 * Returns the RAW parsed object. Translating it is the caller's, through the same schema every other
 * layer goes through — a managed file with a typo must fail by name rather than be tolerated because
 * of where it came from.
 *
 * A file that exists and does not parse is reported and treated as absent. Throwing would let a
 * malformed policy take the terminal down at startup; silently ignoring it would let a broken policy
 * read as no policy. Reporting is the only option that is neither.
 */
export function readManagedSettings(opts: {
  readonly paths?: readonly string[]
  readonly onWarn?: (message: string) => void
} = {}): unknown | null {
  for (const path of opts.paths ?? MANAGED_PATHS) {
    if (!existsSync(path)) continue
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as unknown
    } catch (err) {
      opts.onWarn?.(
        `managed-settings.json at ${path} could not be read, so the organisation policy in it is ` +
          `NOT being applied: ${err instanceof Error ? err.message : String(err)}`,
      )
      return null
    }
  }
  return null
}
