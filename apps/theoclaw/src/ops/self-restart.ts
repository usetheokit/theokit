import { spawn } from 'node:child_process'

/**
 * Self-restart for a changed restart-required setting (B-716, OC-94). The successor is the same
 * command with the environment the first process was started with, so it reads the configuration
 * file afresh, and it waits for this process to exit before it starts, so the port and the instance
 * lock are free. The caller then stops this process through its normal graceful shutdown.
 */
export const PREDECESSOR_VARIABLE = 'THEOCLAW_RESTART_AFTER_PID'

/** Start the successor, detached, with `startEnv`. Returns false when it cannot be spawned. */
export function spawnSuccessor(
  startEnv: Readonly<Record<string, string | undefined>>,
  pid: number = process.pid,
): boolean {
  try {
    const env: NodeJS.ProcessEnv = { ...startEnv, [PREDECESSOR_VARIABLE]: String(pid) }
    const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
      env,
      detached: true,
      stdio: 'inherit',
    })
    child.on('error', () => undefined)
    child.unref()
    return true
  } catch {
    return false
  }
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
  timeoutMs = 30_000,
): Promise<void> {
  const raw = env[PREDECESSOR_VARIABLE]
  delete env[PREDECESSOR_VARIABLE]
  const pid = Number(raw)
  if (raw === undefined || !Number.isInteger(pid) || pid <= 0 || pid === process.pid) return
  const deadline = Date.now() + timeoutMs
  while (alive(pid) && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 50))
}
