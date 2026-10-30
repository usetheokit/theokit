import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { TheoClawConfigError } from './control-plane/errors.js'

/**
 * Which TheoClaw this process is (B-514). With no `THEOCLAW_PROFILE` it is the instance `theoclaw`
 * and nothing moves. With a profile it is `theoclaw-<name>`, and every store the SDK and the app
 * write goes under the SDK's own profiles root, `<home>/.theokit/profiles/<name>` (plan D1): the
 * overrides point `THEOKIT_HOME`, `THEOKIT_AUTH_HOME` and `THEOCLAW_STATE_DIR` at it, and the agent
 * works in its `workspace`, where memory, transcripts and the agent registry follow the cwd.
 */
export interface TheoClawInstance {
  /** `theoclaw-<name>`, or `theoclaw` with no profile. */
  readonly label: string
  readonly profile?: string
  readonly directory?: string
  readonly workspace?: string
  readonly stateDirectory?: string
  /** The environment the process entry writes before the first agent exists; empty with no profile. */
  readonly overrides: Readonly<Record<string, string>>
}

const PROFILE_PATTERN = /^[a-z0-9][a-z0-9-]{0,15}$/

/** The settings a profile sets itself, so an explicit one beside it is refused (plan D3). */
const PROFILE_OWNED = ['THEOKIT_HOME', 'THEOKIT_AUTH_HOME', 'THEOCLAW_STATE_DIR'] as const

export const NO_PROFILE: TheoClawInstance = { label: 'theoclaw', overrides: {} }

type Env = Readonly<Record<string, string | undefined>>

/**
 * The instance `env` names. A name outside the pattern, then a profile beside an explicit home
 * variable, stops the start with `TheoClawConfigError`; neither message carries a value, since a
 * refused name may be a path the operator did not mean to print.
 */
export function resolveInstance(env: Env, options: { readonly homeDir: string }): TheoClawInstance {
  const name = (env.THEOCLAW_PROFILE ?? '').trim()
  if (name === '') return NO_PROFILE
  if (!PROFILE_PATTERN.test(name)) {
    throw new TheoClawConfigError(`THEOCLAW_PROFILE must match ${PROFILE_PATTERN.source}`, { variable: 'THEOCLAW_PROFILE' })
  }
  const conflicts = PROFILE_OWNED.filter((variable) => (env[variable] ?? '').trim() !== '')
  if (conflicts.length > 0) {
    throw new TheoClawConfigError(`THEOCLAW_PROFILE cannot be combined with ${conflicts.join(', ')}: unset them or the profile`, {
      variable: 'THEOCLAW_PROFILE',
    })
  }
  const directory = join(options.homeDir, '.theokit', 'profiles', name)
  const stateDirectory = join(directory, 'state')
  return {
    label: `theoclaw-${name}`,
    profile: name,
    directory,
    workspace: join(directory, 'workspace'),
    stateDirectory,
    overrides: { THEOKIT_HOME: directory, THEOKIT_AUTH_HOME: directory, THEOCLAW_STATE_DIR: stateDirectory },
  }
}

/**
 * Put `instance` into effect: its three directories exist at mode 0700 (one that already existed
 * at another mode is tightened; what it holds is never read or removed), then its overrides are
 * written into `env`. The no-profile instance changes nothing. A directory that cannot be created
 * stops the start with `TheoClawConfigError` naming the path and the code, before `env` changes.
 */
export function applyInstance(instance: TheoClawInstance, env: NodeJS.ProcessEnv): void {
  const { directory, workspace, stateDirectory } = instance
  if (directory === undefined || workspace === undefined || stateDirectory === undefined) return
  for (const path of [directory, workspace, stateDirectory]) {
    try {
      mkdirSync(path, { recursive: true, mode: 0o700 })
      chmodSync(path, 0o700)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? 'unknown error'
      throw new TheoClawConfigError(`THEOCLAW_PROFILE: cannot create ${path}: ${code}`, { variable: 'THEOCLAW_PROFILE' })
    }
  }
  Object.assign(env, instance.overrides)
}
