import type { ChildProcess } from 'node:child_process'

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Kills the whole process group of a child started with `detached: true`, then waits until no process of the group is left. */
export async function stopProcessGroup(child: ChildProcess, timeoutMs = 10_000): Promise<void> {
  const pid = child.pid
  if (pid === undefined) return
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // the group is already gone
  }
  const deadline = Date.now() + timeoutMs
  while (groupAlive(pid)) {
    if (Date.now() > deadline)
      throw new Error(`process group ${pid} still has processes after ${timeoutMs} ms`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
