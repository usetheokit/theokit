import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Writable } from 'node:stream'

import { configurationPath, loadConfiguration } from './config-file.js'
import { resolveInstance } from './instance.js'

export type { Runner, RunResult } from './run-command.js'

/**
 * What the daemon commands share (B-374, B-692): the process IO, the instance's label and
 * configuration path, and the checks every install makes before it writes. The service managers
 * themselves are `@theokit/host/service`'s.
 */

export interface DaemonIo {
  readonly env: NodeJS.ProcessEnv
  readonly homeDir: string
  readonly cwd: string
  readonly platform: NodeJS.Platform
  readonly nodePath: string
  /** The built process entry, `dist/main.js`. */
  readonly entry: string
  /** The user id launchd addresses its `gui/<uid>` domain by; undefined where the platform has none. */
  readonly uid?: number
  readonly stdout: Writable
  readonly stderr: Writable
}

/** The instance a daemon command acts on. */
export interface DaemonTarget {
  readonly label: string
  readonly profile?: string
  /** The profile's own workspace; undefined for the default instance. */
  readonly workspace?: string
  /** Absolute path of the configuration file. */
  readonly configPath: string
}

/** A target that passed the install checks, with the directory the service runs in. */
export interface InstallTarget extends DaemonTarget {
  readonly workingDirectory: string
}

/** The instance's label and its absolute configuration path. */
export function resolveTarget(io: DaemonIo): DaemonTarget {
  const instance = resolveInstance(io.env, { homeDir: io.homeDir })
  const { label, profile, workspace } = instance
  return { label, profile, workspace, configPath: resolve(io.cwd, configurationPath(io.env, io.homeDir)) }
}

/** The target for an install, or undefined after naming the missing configuration file or build on stderr. */
export function checkInstallable(io: DaemonIo): InstallTarget | undefined {
  const target = resolveTarget(io)
  for (const [path, hint] of [[target.configPath, 'run theoclaw onboard first'], [io.entry, 'build TheoClaw first']] as const) {
    if (!existsSync(path)) {
      io.stderr.write(`theoclaw daemon: ${path} does not exist; ${hint}\n`)
      return undefined
    }
  }
  // The service runs where the instance works, so the start's tool root lands in its workspace; a
  // profile owns its workspace, and the file names none.
  const settings: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: target.configPath }
  loadConfiguration(settings, io.homeDir)
  return { ...target, workingDirectory: settings.THEOCLAW_WORKSPACE ?? target.workspace ?? io.homeDir }
}

/** The launchd log the service writes and `theoclaw logs` reads. */
export function logPath(label: string, home: string): string {
  return join(home, 'Library', 'Logs', 'theoclaw', `${label}.log`)
}
