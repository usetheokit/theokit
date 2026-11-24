import { daemonCommands, serviceBackend, type ServiceBackend, UnsupportedPlatformError } from '@theokit/host/service'

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

function commandsFor(io: DaemonIo, runner: Runner, backend: ServiceBackend) {
  return daemonCommands(backend, { stdout: io.stdout, stderr: io.stderr, env: io.env, runner, prefix: 'theoclaw daemon' })
}

export async function daemonInstall(io: DaemonIo, runner: Runner): Promise<number> {
  const backend = backendFor(io, runner)
  if (backend === undefined) return 1
  const target = checkInstallable(io)
  if (target === undefined) return 1
  return attempt(io, () =>
    // A task carries no environment, so on Windows the entry takes the instance as arguments (`entry-arguments.ts`).
    commandsFor(io, runner, backend).install({
      label: target.label,
      description: `TheoClaw (${target.label})`,
      command: io.nodePath,
      args: [io.entry],
      env: { THEOCLAW_CONFIG: target.configPath, ...(target.profile === undefined ? {} : { THEOCLAW_PROFILE: target.profile }) },
      entryArgs: () => ['--config', target.configPath, ...(target.profile === undefined ? [] : ['--profile', target.profile])],
      workingDirectory: target.workingDirectory,
    }),
  )
}

export async function daemonUninstall(io: DaemonIo, runner: Runner): Promise<number> {
  const backend = backendFor(io, runner)
  if (backend === undefined) return 1
  return attempt(io, () => commandsFor(io, runner, backend).uninstall(resolveTarget(io).label))
}

/** Exit 0 when the service is running, 3 otherwise, as `systemctl is-active` answers. */
export async function daemonStatus(io: DaemonIo, runner: Runner): Promise<number> {
  const backend = backendFor(io, runner)
  if (backend === undefined) return 1
  return attempt(io, () => commandsFor(io, runner, backend).status(resolveTarget(io).label))
}

export async function daemonRestart(io: DaemonIo, runner: Runner): Promise<number> {
  const backend = backendFor(io, runner)
  if (backend === undefined) return 1
  return attempt(io, () => commandsFor(io, runner, backend).restart(resolveTarget(io).label))
}
