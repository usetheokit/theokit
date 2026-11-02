import { type DaemonBackend, type DaemonIo, type Runner, checkInstallable, resolveTarget } from './daemon-common.js'
import { launchdBackend } from './daemon-launchd.js'
import { schtasksBackend } from './daemon-schtasks.js'
import { systemdBackend } from './daemon-systemd.js'

/**
 * `theoclaw daemon install|uninstall|status` (B-374, B-692, OC-32): the instance as a login service.
 * This file picks the platform's backend; each backend runs its service manager through an injected
 * `Runner`, so the tests drive the manager's answers and the live check drives the real one.
 */

export { type DaemonIo, type Runner, type RunResult, runCommand } from './daemon-common.js'
export { unitFor, unitPath } from './daemon-systemd.js'

const BACKENDS: Readonly<Partial<Record<NodeJS.Platform, DaemonBackend>>> = {
  linux: systemdBackend,
  darwin: launchdBackend,
  win32: schtasksBackend,
}

function backendFor(io: DaemonIo): DaemonBackend | undefined {
  const backend = BACKENDS[io.platform]
  if (backend === undefined) {
    io.stderr.write(`theoclaw daemon: ${io.platform} is not supported; only Linux (systemd), macOS (launchd) and Windows (Task Scheduler) are\n`)
  }
  return backend
}

export async function daemonInstall(io: DaemonIo, runner: Runner): Promise<number> {
  const backend = backendFor(io)
  if (backend === undefined) return 1
  const target = checkInstallable(io)
  return target === undefined ? 1 : backend.install(io, runner, target)
}

export async function daemonUninstall(io: DaemonIo, runner: Runner): Promise<number> {
  return backendFor(io)?.uninstall(io, runner, resolveTarget(io)) ?? 1
}

export async function daemonStatus(io: DaemonIo, runner: Runner): Promise<number> {
  return backendFor(io)?.status(io, runner, resolveTarget(io)) ?? 1
}
