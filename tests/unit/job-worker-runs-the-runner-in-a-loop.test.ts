import { afterEach, describe, expect, it, vi } from 'vitest'

import { defineJob } from '../../packages/theo/src/server/jobs/define-job.js'
import { InMemoryJobBackend } from '../../packages/theo/src/server/jobs/job-backend-memory.js'
import { createJobRunner, type JobRunner } from '../../packages/theo/src/server/jobs/job-runner.js'
import { createJobWorker, type JobWorker } from '../../packages/theo/src/server/jobs/job-worker.js'

/**
 * `createJobRunner(...).tick()` runs one dequeue cycle and its doc left "the loop" to the caller;
 * `theokit start` had none, so enqueued jobs sat in the backend forever (usetheokit/theokit#1010).
 * The worker is that loop: tick until idle, wait, tick again, back off on errors, and stop only
 * after the job in hand has finished.
 */
let worker: JobWorker | undefined

afterEach(async () => {
  await worker?.stop()
  worker = undefined
  vi.restoreAllMocks()
})

function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((ok, fail) => {
    const poll = (): void => {
      if (check()) return ok()
      if (Date.now() > deadline) return fail(new Error('condition not met in time'))
      setTimeout(poll, 5)
    }
    poll()
  })
}

describe('createJobWorker', () => {
  it('runs a job enqueued after it started, within the poll interval', async () => {
    const backend = new InMemoryJobBackend()
    const ran: unknown[] = []
    const runner = createJobRunner(backend, [
      defineJob('hello', {
        handler: ({ input }) => {
          ran.push(input)
        },
      }),
    ])
    worker = createJobWorker(runner, { pollIntervalMs: 10 })
    worker.start()
    await backend.enqueue({ name: 'hello', input: { n: 1 } })
    await until(() => ran.length === 1)
    expect(ran).toEqual([{ n: 1 }])
  })

  it('stop waits for the job in hand, then ticks no more', async () => {
    let release!: () => void
    const finished: string[] = []
    const ticks = { count: 0 }
    const runner: JobRunner = {
      tick: async () => {
        ticks.count++
        if (ticks.count === 1) {
          await new Promise<void>((r) => (release = r))
          finished.push('job')
          return 1
        }
        return 0
      },
    }
    worker = createJobWorker(runner, { pollIntervalMs: 10 })
    worker.start()
    await until(() => ticks.count === 1)
    const stopped = worker.stop()
    let resolved = false
    void stopped.then(() => (resolved = true))
    await new Promise((r) => setTimeout(r, 30))
    expect(resolved).toBe(false)
    release()
    await stopped
    expect(finished).toEqual(['job'])
    const after = ticks.count
    await new Promise((r) => setTimeout(r, 50))
    expect(ticks.count).toBe(after)
  })

  it('a failing tick is logged and the loop keeps going', async () => {
    const error = vi.spyOn(console, 'log').mockImplementation(() => {})
    let calls = 0
    const runner: JobRunner = {
      tick: () => {
        calls++
        if (calls === 1) return Promise.reject(new Error('connection refused'))
        return Promise.resolve(0)
      },
    }
    worker = createJobWorker(runner, { pollIntervalMs: 5, maxErrorBackoffMs: 20 })
    worker.start()
    await until(() => calls >= 3)
    const logged = error.mock.calls.map((c) => String(c[0])).join('\n')
    expect(logged).toContain('connection refused')
  })
})
