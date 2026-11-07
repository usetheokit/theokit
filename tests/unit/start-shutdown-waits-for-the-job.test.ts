import type { Server } from 'node:http'

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { installGracefulShutdown } from '../../packages/theo/src/cli/commands/start/graceful-shutdown'

// usetheokit/theokit#1292: how long SIGTERM waits for the job in progress is the app's to say.
describe('theokit start on SIGTERM, with a job in progress', () => {
  let exit: ReturnType<typeof vi.spyOn>
  const server = { close: (done: () => void) => done() } as unknown as Server

  // Shutdown imports these lazily; loading them first keeps that real I/O out of the fake clock.
  beforeAll(async () => {
    await import('@theokit/sdk').catch(() => null)
    await import('../../packages/theo/src/server/storage/storage-manager')
    await import('../../packages/theo/src/server/observability-bootstrap')
  })

  beforeEach(() => {
    // Only the clock is fake: shutdown's dynamic imports need the real event loop to settle.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  })
  afterEach(() => {
    process.removeAllListeners('SIGTERM')
    process.removeAllListeners('SIGINT')
    exit.mockRestore()
    vi.useRealTimers()
  })

  /** A background stop that resolves once the job, which runs for `ms`, has finished. */
  const jobRunningFor = (ms: number) => {
    const state = { finished: false }
    const stop = () =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          state.finished = true
          resolve()
        }, ms),
      )
    return { state, stop }
  }

  /** Whether the job had finished at the moment the process exited. */
  const finishedAtExit = async (job: { state: { finished: boolean } }) => {
    const seen: boolean[] = []
    exit.mockImplementation((() => {
      seen.push(job.state.finished)
    }) as never)
    process.emit('SIGTERM', 'SIGTERM')
    // A second of the clock per turn, then a real turn of the event loop for the imports.
    for (let second = 0; second < 120 && seen.length === 0; second++) {
      await vi.advanceTimersByTimeAsync(1_000)
      for (let turn = 0; turn < 20 && seen.length === 0; turn++) {
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
    expect(seen).not.toHaveLength(0)
    return seen[0]
  }

  it('waits for the job as long as the app allows, then exits', async () => {
    const job = jobRunningFor(60_000)
    installGracefulShutdown(server, job.stop, { backgroundStopTimeoutMs: 90_000 })

    expect(await finishedAtExit(job)).toBe(true)
  })

  it('moves on after 20 seconds when the app says nothing, as before', async () => {
    const job = jobRunningFor(60_000)
    installGracefulShutdown(server, job.stop)

    expect(await finishedAtExit(job)).toBe(false)
  })
})
