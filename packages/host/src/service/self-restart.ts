import { spawn, type SpawnOptions } from 'node:child_process'

import { RestartError } from './errors.js'

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

export interface RestartSelfOptions {
  /** The environment the first process was started with; the successor gets it. */
  readonly startEnv: Readonly<Record<string, string | undefined>>
  /** Test seam: replaces `child_process.spawn`. */
  readonly spawn?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => {
    pid?: number
    unref(): void
    on(event: 'error', listener: (error: Error) => void): unknown
  }
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
}

/**
 * Under a supervisor returns `{ kind: 'exit', code: 75 }` and the caller exits with it. Otherwise
 * starts a detached successor that waits for this process (see `waitForPredecessor`).
 * Throws RestartError, with the spawn error as `cause`, when the successor cannot be started.
 */
export function restartSelf(
  options: RestartSelfOptions,
): { kind: 'exit'; code: number } | { kind: 'spawned'; pid: number } {
  if (isSupervised(options.env, options.platform)) return { kind: 'exit', code: RESTART_EXIT_CODE }
  const env: NodeJS.ProcessEnv = {
    ...options.startEnv,
    [RESTART_AFTER_PID_VARIABLE]: String(process.pid),
  }
  const start = options.spawn ?? spawn
  let child: ReturnType<NonNullable<RestartSelfOptions['spawn']>>
  try {
    child = start(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      env,
      detached: true,
      stdio: 'inherit',
    })
  } catch (cause) {
    throw new RestartError('could not start the successor process', { cause })
  }
  // Spawn failures that Node reports through the event come after this call returns; keep them
  // from becoming an unhandled 'error' event on the caller's process.
  child.on('error', () => undefined)
  if (child.pid === undefined) {
    throw new RestartError('could not start the successor process: spawn returned no pid', {
      cause: new Error(`spawn ${process.execPath} did not start`),
    })
  }
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
