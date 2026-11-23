import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { acquireInstanceLock, applyProfile, resolveProfile } from '@theokit/sdk/persistence'
import type { InstanceLock, ResolvedProfile } from '@theokit/sdk/persistence'

import { TheoClawConfigError } from './control-plane/errors.js'

/**
 * Which TheoClaw this process is (B-514). With no `THEOCLAW_PROFILE` it is the instance `theoclaw`
 * and nothing moves. With a profile it is `theoclaw-<name>`, and every store the SDK and the app
 * write goes under the SDK's own profiles root, `<home>/.theokit/profiles/<name>` (plan D1): the
 * overrides point `THEOKIT_HOME`, `THEOKIT_AUTH_HOME` and `THEOCLAW_STATE_DIR` at it, and
 * `THEOCLAW_WORKSPACE` at its `workspace`, where every agent works and the chat sessions keep their
 * transcripts and `sessions.json`: memory, transcripts and the agent registry follow the cwd.
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

/** The app directories a profile holds beside the SDK's two homes, relative to the profile directory. */
const APP_DIRECTORIES = { THEOCLAW_STATE_DIR: 'state', THEOCLAW_WORKSPACE: 'workspace' } as const

export const NO_PROFILE: TheoClawInstance = { label: 'theoclaw', overrides: {} }

/** The first line a start writes, naming the instance and where its state lives. */
export function startLine(instance: TheoClawInstance): string {
  return instance.directory === undefined
    ? 'theoclaw: instance started, no profile'
    : `${instance.label}: instance started, profile directory ${instance.directory}`
}

type Env = Readonly<Record<string, string | undefined>>

/**
 * The instance `env` names. A name outside the pattern, then a profile beside an explicit home
 * variable, stops the start with `TheoClawConfigError`; neither message carries a value, since a
 * refused name may be a path the operator did not mean to print.
 */
export function resolveInstance(env: Env, options: { readonly homeDir: string }): TheoClawInstance {
  const name = (env.THEOCLAW_PROFILE ?? '').trim()
  if (name === '') return NO_PROFILE
  let profile: ResolvedProfile
  try {
    profile = resolveProfile(name, {
      profilesRoot: join(options.homeDir, '.theokit', 'profiles'),
      appDirectories: APP_DIRECTORIES,
    })
  } catch (error) {
    // Only the SDK's name refusal is the operator's name; anything else is not, and passes through.
    if ((error as { code?: unknown }).code !== 'profile_name_invalid') throw error
    throw new TheoClawConfigError(
      'THEOCLAW_PROFILE must be 1 to 16 lowercase letters, digits or hyphens, starting with a letter or digit',
      { variable: 'THEOCLAW_PROFILE' },
    )
  }
  // The SDK checks a conflict when it applies the profile, after the lock; this start refuses it first.
  const conflicts = Object.keys(profile.env).filter((variable) => (env[variable] ?? '').trim() !== '')
  if (conflicts.length > 0) {
    throw new TheoClawConfigError(`THEOCLAW_PROFILE cannot be combined with ${conflicts.join(', ')}: unset them or the profile`, {
      variable: 'THEOCLAW_PROFILE',
    })
  }
  return {
    label: `theoclaw-${name}`,
    profile: name,
    directory: profile.directory,
    workspace: profile.env.THEOCLAW_WORKSPACE,
    stateDirectory: profile.env.THEOCLAW_STATE_DIR,
    overrides: profile.env,
  }
}

/**
 * Put `instance` into effect through the SDK's `applyProfile`: its three directories exist at mode
 * 0700 (one that already existed at another mode is tightened; what it holds is never read or
 * removed), then its overrides are written into `env`. The no-profile instance changes nothing. A
 * directory that cannot be created stops the start with `TheoClawConfigError` naming the path and
 * the code, before `env` changes.
 */
export async function applyInstance(
  instance: TheoClawInstance,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const { profile, directory, workspace, stateDirectory } = instance
  if (
    profile === undefined ||
    directory === undefined ||
    workspace === undefined ||
    stateDirectory === undefined
  )
    return
  // Applied to a scratch environment, so a repeated apply is not a conflict with its own first run.
  const scratch: NodeJS.ProcessEnv = {}
  try {
    await applyProfile(
      {
        name: profile,
        directory,
        directories: [directory, workspace, stateDirectory],
        env: instance.overrides,
      },
      scratch,
    )
  } catch (error) {
    // Only the SDK's directory failure is a directory that cannot be created; anything else passes through.
    if ((error as { code?: unknown }).code !== 'profile_directory_failed') throw error
    const cause = (error as { cause?: NodeJS.ErrnoException }).cause
    throw new TheoClawConfigError(
      `THEOCLAW_PROFILE: cannot create ${directory}: ${cause?.code ?? 'unknown error'}`,
      { variable: 'THEOCLAW_PROFILE' },
    )
  }
  Object.assign(env, scratch)
}

/**
 * Take `<stateDir>.instance.lock` through the SDK's `acquireInstanceLock` (FR-010), the lock a start,
 * a backup and a restore share. Creates only the lock's parent directory, at 0700, as before.
 */
export async function takeInstanceLock(stateDir: string): Promise<InstanceLock> {
  mkdirSync(dirname(resolve(stateDir)), { recursive: true, mode: 0o700 })
  return acquireInstanceLock(stateDir)
}

/** Where the start's lock goes: the instance's state directory, or `undefined` with none (no lock). */
function stateDirOf(instance: TheoClawInstance, env: NodeJS.ProcessEnv): string | undefined {
  const dir = instance.stateDirectory ?? env.THEOCLAW_STATE_DIR?.trim()
  return dir === undefined || dir === '' ? undefined : dir
}

/**
 * The start's half of FR-010: take the instance lock, then put the instance into effect. The lock
 * comes BEFORE `applyInstance` creates the targets, so a start refused by a restore's lock leaves an
 * absent target absent. An instance with no state directory has nothing to protect and takes none.
 * Returns the lock, or `undefined` when none was taken.
 */
export async function claimInstance(
  instance: TheoClawInstance,
  env: NodeJS.ProcessEnv,
  hooks: { readonly beforeLock?: () => void } = {},
): Promise<InstanceLock | undefined> {
  const stateDir = stateDirOf(instance, env)
  hooks.beforeLock?.()
  const lock = stateDir === undefined ? undefined : await takeInstanceLock(stateDir)
  try {
    await applyInstance(instance, env)
  } catch (error) {
    await lock?.release()
    throw error
  }
  return lock
}

/**
 * Remove the lock file synchronously, for the `exit` event (which allows no await), but only while
 * the claim still names this process: a file the SDK's takeover gave to another process stays.
 */
export function removeOwnLockSync(lockPath: string): void {
  try {
    const claim = JSON.parse(readFileSync(lockPath, 'utf8')) as { pid?: unknown }
    if (claim.pid === process.pid) rmSync(lockPath, { force: true })
  } catch {
    // Absent or unreadable: nothing of this process's to remove.
  }
}
