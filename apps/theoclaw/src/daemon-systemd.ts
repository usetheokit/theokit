import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { DaemonBackend, DaemonIo, Runner, RunResult } from './daemon-common.js'

/** The Linux backend (B-374, OC-32): a `systemd --user` unit that runs the built entry. */

/** The user manager reads `~/.config/systemd/user`, whatever a process's own `XDG_CONFIG_HOME` says. */
export function unitPath(label: string, home: string): string {
  return join(home, '.config', 'systemd', 'user', `${label}.service`)
}

/**
 * systemd.syntax(7): a value with a space, a quote or a backslash is double-quoted; `%` and `$`
 * are doubled, since systemd expands specifiers and variables in ExecStart and Environment.
 */
function quoted(value: string): string {
  const escaped = value.replaceAll('%', '%%').replaceAll('$', '$$$$')
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

export const systemdBackend: DaemonBackend = {
  async install(io, runner, target) {
    const { label, profile, configPath, workingDirectory } = target
    const unit = unitPath(label, io.homeDir)
    mkdirSync(dirname(unit), { recursive: true })
    const temporary = `${unit}.${process.pid}.tmp`
    writeFileSync(temporary, unitFor({ label, nodePath: io.nodePath, entryPath: io.entry, configPath, profile, workingDirectory }))
    renameSync(temporary, unit)
    // `enable --now` leaves a running unit as it is, so a reinstall restarts it onto the new unit file.
    for (const args of [['daemon-reload'], ['enable', '--now', `${label}.service`], ['restart', `${label}.service`]]) {
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
  },

  async uninstall(io, runner, target) {
    const { label } = target
    // A unit that is not loaded has nothing to disable; the file and the reload are what matter.
    await systemctl(runner, 'disable', '--now', `${label}.service`)
    rmSync(unitPath(label, io.homeDir), { force: true })
    const reload = await systemctl(runner, 'daemon-reload')
    if (reload.code !== 0) {
      io.stderr.write(`theoclaw daemon: systemctl --user daemon-reload failed: ${reload.stderr.trim()}\n`)
      return 1
    }
    io.stdout.write(`theoclaw daemon: ${label}.service removed\n`)
    return 0
  },

  /** Exit 0 when the unit is active, 3 otherwise, as `systemctl is-active` itself answers. */
  async status(io, runner, target) {
    const answer = await systemctl(runner, 'is-active', `${target.label}.service`)
    const state = answer.stdout.trim() || 'unknown'
    io.stdout.write(`${target.label}.service: ${state}\n`)
    return state === 'active' ? 0 : 3
  },
}
