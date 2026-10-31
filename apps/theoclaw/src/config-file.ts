import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
