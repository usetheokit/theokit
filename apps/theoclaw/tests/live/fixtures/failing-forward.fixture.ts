import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'

import { describe, it, vi } from 'vitest'

import { useForwardCleanup } from '../support/forward-cleanup.js'
import { openSshForward, type SpawnRecord } from '../support/ssh-forward.js'

/**
 * EC-1's intended failure (B-512, T1.2), run only by `ssh-forward-cleanup.live.test.ts` in a child
 * vitest through `vitest.fixture.config.ts`. Test A throws with a forward open; test B runs after
 * the `afterEach` that `useForwardCleanup()` registers and before any process `exit` handler, and
 * records whether the two children are still alive.
 */
function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`fixture: ${name} is not set`)
  return value
}

/** The `code` of the error `process.kill(pid, 0)` throws, or `ALIVE` when it does not throw. */
function signalZeroErrorCode(pid: number): string {
  try {
    process.kill(pid, 0)
    return 'ALIVE'
  } catch (error) {
    return (error as NodeJS.ErrnoException).code ?? String(error)
  }
}

describe('a forward a failing test left open', () => {
  vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
  useForwardCleanup()

  it('throws with the forward open', async () => {
    const echo = createServer((socket) => socket.pipe(socket))
    await new Promise<void>((resolve) => echo.listen(0, '127.0.0.1', resolve))
    echo.unref()
    const address = echo.address()
    if (address === null || typeof address === 'string') throw new Error('fixture: no TCP address for the echo server')
    const spawned: SpawnRecord[] = []
    await openSshForward({ targetPort: address.port, onSpawn: (record) => spawned.push(record) })
    const pid = (name: string): number | undefined => spawned.find((record) => record.name === name)?.pid
    writeFileSync(requiredEnv('FIXTURE_PIDS_FILE'), JSON.stringify({ sshdPid: pid('sshd'), sshPid: pid('ssh') }))
    throw new Error('fixture: intended failure')
  })

  it('records whether the children outlived the hook', () => {
    const { sshdPid, sshPid } = JSON.parse(readFileSync(requiredEnv('FIXTURE_PIDS_FILE'), 'utf8')) as {
      sshdPid: number
      sshPid: number
    }
    writeFileSync(requiredEnv('FIXTURE_RESULT_FILE'), JSON.stringify([signalZeroErrorCode(sshdPid), signalZeroErrorCode(sshPid)]))
  })
})
