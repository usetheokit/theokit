import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Writable } from 'node:stream'

import { configurationPath, loadConfiguration } from './config-file.js'
import { describeError } from './control-plane/errors.js'
import { resolveInstance } from './instance.js'

/**
 * `theoclaw daemon install|uninstall|status` (B-374, OC-32): the instance as a `systemd --user`
 * unit that runs the built entry with the configuration file. Every command goes through an
 * injected `Runner`, so the tests drive systemctl's answers and the live check drives the real one.
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
  readonly stdout: Writable
  readonly stderr: Writable
}

/** The registered item that carries launchd and the Windows scheduler (T6.1). */
export const UNSUPPORTED_PLATFORM_ITEM = 'the macOS and Windows follow-up'

/** The command runner of the real process: `execFile`, with a command that cannot start as 127. */
export const runCommand: Runner = (command, args) =>
  new Promise((settle) => {
    execFile(command, [...args], { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error === null) return settle({ code: 0, stdout, stderr })
      const code = typeof error.code === 'number' ? error.code : 127
      settle({ code, stdout, stderr: stderr || describeError(error) })
    })
  })

/** The user manager reads `~/.config/systemd/user`, whatever a process's own `XDG_CONFIG_HOME` says. */
export function unitPath(label: string, home: string): string {
  return join(home, '.config', 'systemd', 'user', `${label}.service`)
}

/** systemd.syntax(7): a value with a space, a quote or a backslash is double-quoted; `%` is doubled. */
function quoted(value: string): string {
  const escaped = value.replaceAll('%', '%%')
  return /[\s"\\]/.test(escaped) ? `"${escaped.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : escaped
}

export interface UnitInput {
  readonly label: string
  readonly nodePath: string
  readonly entryPath: string
  readonly configPath: string
  readonly profile?: string
  readonly workingDirectory: string
}

export function unitFor(input: UnitInput): string {
  return [
    '[Unit]',
    `Description=TheoClaw (${input.label})`,
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${quoted(input.nodePath)} ${quoted(input.entryPath)}`,
    `Environment=${quoted(`THEOCLAW_CONFIG=${input.configPath}`)}`,
    ...(input.profile === undefined ? [] : [`Environment=${quoted(`THEOCLAW_PROFILE=${input.profile}`)}`]),
    `WorkingDirectory=${quoted(input.workingDirectory)}`,
    'Restart=on-failure',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n')
}

/** The instance's label, its absolute configuration path, and the unit file both name. */
function target(io: DaemonIo): { label: string; profile?: string; configPath: string; unit: string } {
  const instance = resolveInstance(io.env, { homeDir: io.homeDir })
  const configPath = resolve(io.cwd, configurationPath(io.env, io.homeDir))
  return { label: instance.label, profile: instance.profile, configPath, unit: unitPath(instance.label, io.homeDir) }
}

function refuseUnsupported(io: DaemonIo): boolean {
  if (io.platform === 'linux') return false
  io.stderr.write(`theoclaw daemon: ${io.platform} is not supported; only a Linux systemd user unit is (${UNSUPPORTED_PLATFORM_ITEM})\n`)
  return true
}

async function systemctl(runner: Runner, ...args: string[]): Promise<RunResult> {
  return runner('systemctl', ['--user', ...args])
}

async function reportLinger(io: DaemonIo, runner: Runner): Promise<void> {
  const user = io.env.USER
  if (user === undefined || user === '') return
  const answer = await runner('loginctl', ['show-user', user, '-p', 'Linger'])
  if (answer.code === 0 && answer.stdout.trim() === 'Linger=no') {
    io.stdout.write(`theoclaw daemon: the unit stops when you log out; run loginctl enable-linger ${user} to keep it running\n`)
  }
}

export async function daemonInstall(io: DaemonIo, runner: Runner): Promise<number> {
  if (refuseUnsupported(io)) return 1
  const { label, profile, configPath, unit } = target(io)
  for (const [path, hint] of [[configPath, 'run theoclaw onboard first'], [io.entry, 'build TheoClaw first']] as const) {
    if (!existsSync(path)) {
      io.stderr.write(`theoclaw daemon: ${path} does not exist; ${hint}\n`)
      return 1
    }
  }
  // The unit runs where the instance works, so the start's tool root lands in its workspace.
  const settings: NodeJS.ProcessEnv = { THEOCLAW_CONFIG: configPath }
  loadConfiguration(settings, io.homeDir)
  const workingDirectory = settings.THEOCLAW_WORKSPACE ?? io.homeDir
  mkdirSync(dirname(unit), { recursive: true })
  const temporary = `${unit}.${process.pid}.tmp`
  writeFileSync(temporary, unitFor({ label, nodePath: io.nodePath, entryPath: io.entry, configPath, profile, workingDirectory }))
  renameSync(temporary, unit)
  for (const args of [['daemon-reload'], ['enable', '--now', `${label}.service`]]) {
    const result = await systemctl(runner, ...args)
    if (result.code !== 0) {
      io.stderr.write(`theoclaw daemon: systemctl --user ${args.join(' ')} failed: ${result.stderr.trim()}\n`)
      rmSync(unit, { force: true })
      await systemctl(runner, 'daemon-reload')
      return 1
    }
  }
  io.stdout.write(`theoclaw daemon: ${label}.service installed and started (${unit})\n`)
  await reportLinger(io, runner)
  return 0
}

export async function daemonUninstall(io: DaemonIo, runner: Runner): Promise<number> {
  if (refuseUnsupported(io)) return 1
  const { label, unit } = target(io)
  // A unit that is not loaded has nothing to disable; the file and the reload are what matter.
  await systemctl(runner, 'disable', '--now', `${label}.service`)
  rmSync(unit, { force: true })
  const reload = await systemctl(runner, 'daemon-reload')
  if (reload.code !== 0) {
    io.stderr.write(`theoclaw daemon: systemctl --user daemon-reload failed: ${reload.stderr.trim()}\n`)
    return 1
  }
  io.stdout.write(`theoclaw daemon: ${label}.service removed\n`)
  return 0
}

/** Exit 0 when the unit is active, 3 otherwise, as `systemctl is-active` itself answers. */
export async function daemonStatus(io: DaemonIo, runner: Runner): Promise<number> {
  if (refuseUnsupported(io)) return 1
  const { label } = target(io)
  const answer = await systemctl(runner, 'is-active', `${label}.service`)
  const state = answer.stdout.trim() || 'unknown'
  io.stdout.write(`${label}.service: ${state}\n`)
  return state === 'active' ? 0 : 3
}
