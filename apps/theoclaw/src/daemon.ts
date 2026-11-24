import { serviceBackend, type ServiceBackend, type ServiceSpec, UnsupportedPlatformError } from '@theokit/host/service'

import { theoclawConfig } from './config-file.js'
import { describeError } from './control-plane/errors.js'
import { type DaemonIo, checkInstallable, logPath, resolveTarget } from './daemon-common.js'
import type { Runner } from './run-command.js'

/**
 * `theoclaw daemon install|uninstall|status|restart` (B-374, B-692, OC-32): the instance as a login
 * service. The service managers are `@theokit/host/service`'s; this file maps the instance to a
 * `ServiceSpec` and the backend's answers to the command's output and exit code. The backend runs
 * its manager through the injected `Runner`, so the tests drive the manager's answers and the live
 * check drives the real one.
 */

export { type DaemonIo } from './daemon-common.js'

function backendFor(io: DaemonIo, runner: Runner): ServiceBackend | undefined {
  const logFile = logPath(resolveTarget(io).label, io.homeDir)
  try {
    return serviceBackend(io.platform, { runner, homeDir: io.homeDir, env: io.env, ...(io.uid === undefined ? {} : { uid: io.uid }), logFile })
  } catch (error) {
    if (!(error instanceof UnsupportedPlatformError)) throw error
    io.stderr.write(`theoclaw daemon: ${io.platform} is not supported; only Linux (systemd), macOS (launchd) and Windows (Task Scheduler) are\n`)
    return undefined
  }
}

/** Where the platform's service definition for `label` lives; the file `update` looks for. */
export function definitionPath(platform: NodeJS.Platform, label: string, homeDir: string): string {
  return serviceBackend(platform === 'darwin' ? 'darwin' : 'linux', { homeDir }).definitionPath({ label })
}

async function attempt(io: DaemonIo, action: () => Promise<number>): Promise<number> {
  try {
    return await action()
  } catch (error) {
    io.stderr.write(`theoclaw daemon: ${describeError(error)}\n`)
    return 1
  }
}

/**
 * On Linux the user manager stops the unit at logout unless lingering is on. `serviceBackend` has no
 * linger check, so the app keeps this one notice; the package gap is not filed yet (the factory cannot open issues).
 */
async function reportLinger(io: DaemonIo, runner: Runner): Promise<void> {
  const user = io.env.USER
  if (io.platform !== 'linux' || user === undefined || user === '') return
  const answer = await runner('loginctl', ['show-user', user, '-p', 'Linger'])
  if (answer.code === 0 && answer.stdout.trim() === 'Linger=no') {
    io.stdout.write(`theoclaw daemon: the unit stops when you log out; run loginctl enable-linger ${user} to keep it running\n`)
  }
}

export async function daemonInstall(io: DaemonIo, runner: Runner): Promise<number> {
  const backend = backendFor(io, runner)
  if (backend === undefined) return 1
  const target = checkInstallable(io)
  if (target === undefined) return 1
  return attempt(io, async () => {
    // A task carries no environment, so on Windows the entry takes the instance as arguments.
    const windows = io.platform === 'win32'
    const spec: ServiceSpec = {
      label: target.label,
      description: `TheoClaw (${target.label})`,
      command: io.nodePath,
      args: windows
        ? [io.entry, ...theoclawConfig.entryArgs({ THEOCLAW_CONFIG: target.configPath, ...(target.profile === undefined ? {} : { THEOCLAW_PROFILE: target.profile }) }, io.homeDir)]
        : [io.entry],
      ...(windows ? {} : { env: { THEOCLAW_CONFIG: target.configPath, ...(target.profile === undefined ? {} : { THEOCLAW_PROFILE: target.profile }) } }),
      workingDirectory: target.workingDirectory,
    }
    await backend.install(spec)
    io.stdout.write(`theoclaw daemon: ${target.label} installed and started (${backend.definitionPath(spec)})\n`)
    await reportLinger(io, runner)
    return 0
  })
}

export async function daemonUninstall(io: DaemonIo, runner: Runner): Promise<number> {
  const backend = backendFor(io, runner)
  if (backend === undefined) return 1
  const { label } = resolveTarget(io)
  return attempt(io, async () => {
    await backend.uninstall(label)
    io.stdout.write(`theoclaw daemon: ${label} removed\n`)
    return 0
  })
}

/** Exit 0 when the service is running, 3 otherwise, as `systemctl is-active` answers. */
export async function daemonStatus(io: DaemonIo, runner: Runner): Promise<number> {
  const backend = backendFor(io, runner)
  if (backend === undefined) return 1
  const { label } = resolveTarget(io)
  return attempt(io, async () => {
    const state = await backend.status(label)
    io.stdout.write(`${label}: ${state}\n`)
    return state === 'running' ? 0 : 3
  })
}

export async function daemonRestart(io: DaemonIo, runner: Runner): Promise<number> {
  const backend = backendFor(io, runner)
  if (backend === undefined) return 1
  const { label } = resolveTarget(io)
  return attempt(io, async () => {
    await backend.restart(label)
    io.stdout.write(`theoclaw daemon: ${label} restarted\n`)
    return 0
  })
}
