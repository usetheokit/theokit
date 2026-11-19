import { spawn, type SpawnOptions } from 'node:child_process'

import { RestartError, UnsupportedPlatformError } from './errors.js'

/**
 * Under a supervisor a detached child would die with the unit's control group (systemd) or be
 * unmanaged (launchd), so the process exits with this code and the supervisor starts it again.
 */
export const RESTART_EXIT_CODE = 75

/** The variable that carries the predecessor's pid to the successor. */
export const RESTART_AFTER_PID_VARIABLE = 'THEOKIT_HOST_RESTART_AFTER_PID'

/** Whether a service manager that restarts on a failed exit started this process. */
export function isSupervised(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform === 'linux') return env.INVOCATION_ID !== undefined && env.INVOCATION_ID !== ''
  if (platform === 'darwin') {
    return (
      env.XPC_SERVICE_NAME !== undefined &&
      env.XPC_SERVICE_NAME !== '' &&
      env.XPC_SERVICE_NAME !== '0'
    )
  }
  return false
}

interface SuccessorProcess {
  readonly pid?: number
  unref(): void
  once(event: 'error', listener: (error: Error) => void): unknown
  once(event: 'spawn', listener: () => void): unknown
}

export interface RestartSelfOptions {
  /** The environment the first process was started with; the successor gets it. */
  readonly startEnv: Readonly<Record<string, string | undefined>>
  /** Test seam: replaces `child_process.spawn`. */
  readonly spawn?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => SuccessorProcess
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
}

/**
 * Under a supervisor resolves `{ kind: 'exit', code: 75 }` and the caller exits with it. Otherwise
 * starts a detached successor that waits for this process (see `waitForPredecessor`) and resolves
 * `{ kind: 'spawned', pid }`. Node reports a failed spawn through the child's `error` event, after
 * `spawn` has returned, so the call is asynchronous: it rejects with a RestartError whose `cause`
 * is that actual error (or the error thrown by `spawn`). A platform other than linux or darwin
 * rejects with UnsupportedPlatformError.
 */
export async function restartSelf(
  options: RestartSelfOptions,
): Promise<{ kind: 'exit'; code: number } | { kind: 'spawned'; pid: number }> {
  const platform = options.platform ?? process.platform
  if (platform !== 'linux' && platform !== 'darwin') throw new UnsupportedPlatformError(platform)
  if (isSupervised(options.env, platform)) return { kind: 'exit', code: RESTART_EXIT_CODE }
  const env: NodeJS.ProcessEnv = {
    ...options.startEnv,
    [RESTART_AFTER_PID_VARIABLE]: String(process.pid),
  }
  const start: NonNullable<RestartSelfOptions['spawn']> = options.spawn ?? spawn
  let child: SuccessorProcess
  try {
    child = start(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      env,
      detached: true,
      stdio: 'inherit',
    })
  } catch (cause) {
    throw new RestartError('could not start the successor process', { cause })
  }
  const failed = new Promise<never>((_resolve, reject) => {
    child.once('error', (cause) => {
      reject(new RestartError('could not start the successor process', { cause }))
    })
  })
  // A started child has a pid; without one, Node emits the real error on the next tick.
  if (child.pid === undefined) return failed
  failed.catch(() => undefined)
  child.unref()
  return { kind: 'spawned', pid: child.pid }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** At the start of a successor: wait (bounded) until the process it replaces is gone, and clear the marker. */
export async function waitForPredecessor(
  env: NodeJS.ProcessEnv,
  options: { timeoutMs?: number } = {},
): Promise<void> {
  const raw = env[RESTART_AFTER_PID_VARIABLE]
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the key is a constant
  delete env[RESTART_AFTER_PID_VARIABLE]
  const pid = Number(raw)
  if (raw === undefined || !Number.isInteger(pid) || pid <= 0 || pid === process.pid) return
  const deadline = Date.now() + (options.timeoutMs ?? 30_000)
  while (alive(pid) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50))
}
