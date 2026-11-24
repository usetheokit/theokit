import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { InstanceConfigError, defineInstanceConfig } from '@theokit/host/instance-config'
import { withFileLock } from '@theokit/sdk/persistence'

import { TheoClawConfigError } from './control-plane/errors.js'

/**
 * TheoClaw's configuration file (B-374, plan D2), declared once with `defineInstanceConfig`: the
 * path, the load into the environment, the write, the reload, onboarding and the audit all run on
 * the package. The file holds `KEY="value"` lines; the process entry loads it before anything reads
 * a setting. `undeclared: 'keep'` because peer tokens and provider credentials are named per use.
 */

/** The settings read per agent: a change to one applies to the next session or turn without a restart. */
export const HOT_KEYS = ['THEOCLAW_MODEL', 'THEOCLAW_MODEL_FALLBACK', 'THEOCLAW_THINKING', 'THEOKIT_API_KEY', 'OPENROUTER_API_KEY'] as const

export const theoclawConfig = defineInstanceConfig({
  app: 'theoclaw',
  undeclared: 'keep',
  keys: {
    THEOCLAW_MODEL: { hot: true },
    THEOCLAW_MODEL_FALLBACK: { hot: true },
    THEOCLAW_THINKING: { hot: true },
    THEOKIT_API_KEY: { hot: true, secret: true },
    OPENROUTER_API_KEY: { hot: true, secret: true },
    THEOCLAW_PORT: {},
    THEOCLAW_OWNERS: {},
    THEOCLAW_WORKSPACE: {},
    THEOCLAW_STATE_DIR: {},
    THEOCLAW_CONTROL_TOKEN: { secret: true, generate: () => randomBytes(24).toString('hex') },
  },
})

/** TheoClaw's wording for what the package refuses; no message carries a value from the file. */
export function asConfigError(error: unknown, path?: string): unknown {
  if (!(error instanceof InstanceConfigError)) return error
  const code = (error.cause as NodeJS.ErrnoException | undefined)?.code ?? 'unknown error'
  switch (error.code) {
    case 'instance_config_missing':
      return new TheoClawConfigError(`THEOCLAW_CONFIG: ${path ?? ''} does not exist`, { variable: 'THEOCLAW_CONFIG' })
    case 'instance_config_unreadable':
      return new TheoClawConfigError(`cannot read ${path ?? ''}: ${code}`, { variable: 'THEOCLAW_CONFIG' })
    case 'instance_config_exists':
      return new TheoClawConfigError(`${path ?? ''} exists; pass --force to replace it`, { variable: 'THEOCLAW_CONFIG' })
    default:
      return new TheoClawConfigError(error.message, error.variable === undefined ? {} : { variable: error.variable })
  }
}

/** A value of only spaces counts as unset, and the others are read trimmed, as the file has always been located. */
function trimmed(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const view = { ...env }
  for (const name of ['THEOCLAW_CONFIG', 'XDG_CONFIG_HOME', 'THEOCLAW_PROFILE']) {
    const value = env[name]?.trim()
    if (value === undefined || value === '') delete view[name]
    else view[name] = value
  }
  return view
}

/** `THEOCLAW_CONFIG` when set, else `<XDG_CONFIG_HOME or ~/.config>/theoclaw/theoclaw.env`, or `theoclaw-<profile>.env`. */
export function configurationPath(env: NodeJS.ProcessEnv, homeDir: string): string {
  try {
    return theoclawConfig.path(trimmed(env), homeDir)
  } catch (error) {
    throw asConfigError(error)
  }
}

/**
 * Copy into `env` every key of the configuration file that `env` does not already hold, so a
 * variable set by the caller always wins. Returns the path read, or `undefined` when the default
 * file does not exist. A missing file that `THEOCLAW_CONFIG` names, or a file that cannot be read,
 * throws `TheoClawConfigError` naming the path.
 */
export function loadConfiguration(env: NodeJS.ProcessEnv, homeDir: string): string | undefined {
  for (const name of ['THEOCLAW_CONFIG', 'XDG_CONFIG_HOME', 'THEOCLAW_PROFILE']) {
    if (env[name] !== undefined && env[name].trim() === '') delete env[name]
  }
  try {
    return theoclawConfig.load(env, homeDir)
  } catch (error) {
    throw asConfigError(error, configurationPath(env, homeDir))
  }
}

/** What `util.parseEnv` cannot read back inside double quotes, since it unescapes nothing. */
const UNWRITABLE: ReadonlyArray<readonly [RegExp, string]> = [
  [/"/, 'a double quote'],
  [/\\/, 'a backslash'],
  [/[\r\n]/, 'a line break'],
]

/**
 * Refuse any entry whose value the file cannot hold, naming the setting and the character class,
 * never the value, which may be the model key.
 */
export function assertWritable(entries: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(entries)) {
    const found = UNWRITABLE.find(([pattern]) => pattern.test(value))
    if (found !== undefined) {
      throw new TheoClawConfigError(`${key} cannot hold ${found[1]} in the configuration file`, { variable: key })
    }
  }
}

/**
 * Write `entries` as `KEY="value"` lines at mode 0600 (a temporary file, then a link or rename, so a
 * reader never sees half a file). An existing file is refused without `force`.
 */
export async function writeConfiguration(path: string, entries: Readonly<Record<string, string>>, options: { readonly force: boolean }): Promise<void> {
  assertWritable(entries)
  // Two calls, in this process or another, are locked per path, so the second checks for the file only
  // after the first has finished and is the one refused without `force`. The lock file sits beside the
  // target, so the directory exists first.
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    await withFileLock(resolve(path), () => theoclawConfig.write(path, entries, options))
  } catch (error) {
    throw asConfigError(error, path)
  }
}
