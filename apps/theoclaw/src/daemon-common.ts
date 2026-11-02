import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Writable } from 'node:stream'

import { configurationPath, loadConfiguration } from './config-file.js'
import { describeError } from './control-plane/errors.js'
import { resolveInstance } from './instance.js'

/**
 * What the three daemon backends share (B-374, B-692): the injected `Runner`, the process IO, the
 * instance's label and configuration path, and the checks every install makes before it writes.
 */

export interface RunResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

/** Runs one command and resolves with its exit code and output; it never rejects on a non-zero exit. */
export type Runner = (command: string, args: readonly string[]) => Promise<RunResult>

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
  /** Absolute path of the configuration file. */
  readonly configPath: string
}

/** A target that passed the install checks, with the directory the service runs in. */
export interface InstallTarget extends DaemonTarget {
  readonly workingDirectory: string
}

/** One platform's service manager. */
export interface DaemonBackend {
  install(io: DaemonIo, runner: Runner, target: InstallTarget): Promise<number>
  uninstall(io: DaemonIo, runner: Runner, target: DaemonTarget): Promise<number>
  status(io: DaemonIo, runner: Runner, target: DaemonTarget): Promise<number>
}

/** The command runner of the real process: `execFile`, with a command that cannot start as 127. */
export const runCommand: Runner = (command, args) =>
  new Promise((settle) => {
    // 64 MiB: `update` runs install.sh through this runner, and pnpm's install output is long.
    execFile(command, [...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error === null) return settle({ code: 0, stdout, stderr })
      const code = typeof error.code === 'number' ? error.code : 127
      settle({ code, stdout, stderr: stderr || describeError(error) })
    })
  })

/** The instance's label and its absolute configuration path. */
export function resolveTarget(io: DaemonIo): DaemonTarget {
  const instance = resolveInstance(io.env, { homeDir: io.homeDir })
  return { label: instance.label, profile: instance.profile, configPath: resolve(io.cwd, configurationPath(io.env, io.homeDir)) }
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
  // The service runs where the instance works, so the start's tool root lands in its workspace.
  const settings: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: target.configPath }
  loadConfiguration(settings, io.homeDir)
  return { ...target, workingDirectory: settings.THEOCLAW_WORKSPACE ?? io.homeDir }
}

/** Writes beside the destination and renames, so a reader never sees half a definition. */
export function writeAtomically(path: string, content: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, content)
  renameSync(temporary, path)
}

/** The XML text escapes shared by the launchd plist and the Task Scheduler definition. */
export function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}
