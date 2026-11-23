import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { CONFIG_SCHEMA_KEYS } from './config-contract.js'
import { translateSettings, type SettingsRead } from './settings-json.js'

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

/** The managed file as Claude Code's dialect: translated like a foreign-root settings file (#1908). */
export interface ManagedSettingsRead extends SettingsRead {
  readonly path: string
}

/** Translate a managed document the way a `.claude/settings.json` is read: foreign keys reported, not fatal. */
export function translateManaged(raw: unknown, baseDir?: string): SettingsRead {
  return translateSettings(raw, {
    ownKeys: CONFIG_SCHEMA_KEYS,
    foreignRoot: true,
    hooksDelivery: 'inert',
    ...(baseDir === undefined ? {} : { baseDir }),
  })
}

/**
 * The enterprise policy, or `null` when no administrator deployed one. A file that exists and does not
 * parse is reported through `onWarn` and treated as absent: throwing would take the terminal down at
 * startup, silence would read a broken policy as no policy.
 *
 * The managed file, its path, and what translating it kept and ignored; `null` when absent or unreadable. */
export function readManagedSettingsTranslated(
  opts: {
    readonly paths?: readonly string[]
    readonly onWarn?: (message: string) => void
  } = {},
): ManagedSettingsRead | null {
  const found = readManagedFile(opts)
  if (found === null) return null
  return { path: found.path, ...translateManaged(found.raw, dirname(found.path)) }
}

function readManagedFile(opts: {
  readonly paths?: readonly string[]
  readonly onWarn?: (message: string) => void
}): { path: string; raw: unknown } | null {
  for (const path of opts.paths ?? MANAGED_PATHS) {
    if (!existsSync(path)) continue
    try {
      return { path, raw: JSON.parse(readFileSync(path, 'utf8')) as unknown }
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
