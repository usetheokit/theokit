import { chmodSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseEnv } from 'node:util'

import { TheoClawConfigError } from './control-plane/errors.js'

/**
 * Where TheoClaw's configuration lives and how it reaches the environment (B-374, plan D2). The
 * file holds `KEY="value"` lines; the process entry loads it before anything reads a setting, so
 * every way of starting TheoClaw (the launcher, the user unit, the image) reads the same file.
 */

type Env = Readonly<Record<string, string | undefined>>

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * `THEOCLAW_CONFIG` when set, else `<XDG_CONFIG_HOME or ~/.config>/theoclaw/theoclaw.env`, or
 * `theoclaw-<profile>.env` with `THEOCLAW_PROFILE`. The profile is read raw: `resolveInstance`
 * validates it next and refuses a bad name before anything else uses it.
 */
export function configurationPath(env: Env, homeDir: string): string {
  const explicit = nonBlank(env.THEOCLAW_CONFIG)
  if (explicit !== undefined) return explicit
  const base = nonBlank(env.XDG_CONFIG_HOME) ?? join(homeDir, '.config')
  const profile = nonBlank(env.THEOCLAW_PROFILE)
  return join(base, 'theoclaw', profile === undefined ? 'theoclaw.env' : `theoclaw-${profile}.env`)
}

/**
 * Copy into `env` every key of the configuration file that `env` does not already hold, so a
 * variable set by the caller always wins. Returns the path read, or `undefined` when the default
 * file does not exist. A missing file that `THEOCLAW_CONFIG` names, or a file that cannot be read,
 * throws `TheoClawConfigError` naming the path; no message carries a value from the file.
 */
export function loadConfiguration(env: NodeJS.ProcessEnv, homeDir: string): string | undefined {
  const path = configurationPath(env, homeDir)
  if (!existsSync(path)) {
    if (nonBlank(env.THEOCLAW_CONFIG) !== undefined) {
      throw new TheoClawConfigError(`THEOCLAW_CONFIG: ${path} does not exist`, { variable: 'THEOCLAW_CONFIG' })
    }
    return undefined
  }
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? 'unknown error'
    throw new TheoClawConfigError(`cannot read ${path}: ${code}`, { variable: 'THEOCLAW_CONFIG' })
  }
  for (const [key, value] of Object.entries(parseEnv(text))) {
    if (env[key] === undefined) env[key] = value
  }
  return path
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
 * Write `entries` as `KEY="value"` lines at mode 0600 in a directory at mode 0700: a temporary
 * file in the same directory, synced, then renamed over `path`, so a reader never sees half a
 * file. An existing file is refused without `force`, before the temporary file exists.
 */
export function writeConfiguration(path: string, entries: Readonly<Record<string, string>>, options: { readonly force: boolean }): void {
  assertWritable(entries)
  if (existsSync(path) && !options.force) {
    throw new TheoClawConfigError(`${path} exists; pass --force to replace it`, { variable: 'THEOCLAW_CONFIG' })
  }
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
  const text = Object.entries(entries).map(([key, value]) => `${key}="${value}"\n`).join('')
  const temporary = `${path}.${process.pid}.tmp`
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    writeSync(fd, text)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}
