import type { Writable } from 'node:stream'

import { ServiceDefinitionError } from './errors.js'
import { runCommand, type Runner } from './runner.js'
import type { ServiceBackend, ServiceSpec } from './spec.js'

/** What `install` registers; the app parsed its own arguments and passes the values. */
export interface DaemonTarget {
  readonly label: string
  readonly description?: string
  readonly command: string
  readonly args: readonly string[]
  /** Passed to the service on Linux and macOS. On Windows a task carries none: `entryArgs` must carry them. */
  readonly env?: Readonly<Record<string, string>>
  /** Defaults to `process.cwd()`. */
  readonly workingDirectory?: string
  /** The arguments that stand for `env` on Windows, such as `instanceConfig.entryArgs`; appended to `args` there. */
  readonly entryArgs?: () => string[]
}

export interface DaemonCommandsIo {
  readonly stdout: Writable
  readonly stderr: Writable
  readonly env: NodeJS.ProcessEnv
  /** Runs `loginctl` for the linger check; defaults to the real process. */
  readonly runner?: Runner
  /** Names the app in the lines printed: `<prefix>: <label> removed`. Default `daemon`. */
  readonly prefix?: string
}

export interface DaemonCommands {
  install(target: DaemonTarget): Promise<number>
  uninstall(label: string): Promise<number>
  /** 0 when running, 3 otherwise, as `systemctl is-active` answers. */
  status(label: string): Promise<number>
  restart(label: string): Promise<number>
  logs(label: string, lines: number): Promise<number>
}

/**
 * Whether the user's systemd manager keeps running after logout: `true` or `false` from `loginctl`,
 * `undefined` when it cannot tell (no loginctl, a refusal, an unexpected answer).
 */
export async function lingerEnabled(
  user: string,
  runner: Runner = runCommand,
): Promise<boolean | undefined> {
  const answer = await runner('loginctl', ['show-user', user, '-p', 'Linger'])
  if (answer.code !== 0) return undefined
  const line = answer.stdout.trim()
  if (line === 'Linger=yes') return true
  if (line === 'Linger=no') return false
  return undefined
}

function specFor(target: DaemonTarget, windows: boolean): ServiceSpec {
  const env = target.env ?? {}
  const hasEnv = Object.keys(env).length > 0
  if (windows && hasEnv && target.entryArgs === undefined) {
    throw new ServiceDefinitionError(
      'env',
      'cannot be set on Windows: a scheduled task carries no environment; pass entryArgs',
    )
  }
  const args =
    windows && target.entryArgs !== undefined
      ? [...target.args, ...target.entryArgs()]
      : target.args
  return {
    label: target.label,
    ...(target.description === undefined ? {} : { description: target.description }),
    command: target.command,
    args,
    ...(windows || !hasEnv ? {} : { env }),
    workingDirectory: target.workingDirectory ?? process.cwd(),
  }
}

/** `install`, `uninstall`, `status`, `restart` and `logs` over a `ServiceBackend`. Backend failures throw. */
export function daemonCommands(backend: ServiceBackend, io: DaemonCommandsIo): DaemonCommands {
  const prefix = io.prefix ?? 'daemon'
  const say = (text: string): void => {
    io.stdout.write(`${prefix}: ${text}\n`)
  }
  return {
    async install(target) {
      const spec = specFor(target, backend.platform === 'win32')
      await backend.install(spec)
      say(`${target.label} installed and started (${backend.definitionPath(spec)})`)
      const user = io.env.USER
      if (backend.platform === 'linux' && user !== undefined && user !== '') {
        if ((await lingerEnabled(user, io.runner)) === false) {
          say(
            `the unit stops when you log out; run loginctl enable-linger ${user} to keep it running`,
          )
        }
      }
      return 0
    },
    async uninstall(label) {
      await backend.uninstall(label)
      say(`${label} removed`)
      return 0
    },
    async status(label) {
      const state = await backend.status(label)
      io.stdout.write(`${label}: ${state}\n`)
      return state === 'running' ? 0 : 3
    },
    async restart(label) {
      await backend.restart(label)
      say(`${label} restarted`)
      return 0
    },
    async logs(label, lines) {
      const text = await backend.logs(label, { lines })
      io.stdout.write(text === '' || text.endsWith('\n') ? text : `${text}\n`)
      return 0
    },
  }
}
