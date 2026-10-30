import { createLogger } from '../observability/logger.js'

import type { JobRunner } from './job-runner.js'

/**
 * The loop around `JobRunner.tick()`.
 *
 * `tick()` runs one dequeue-and-dispatch cycle and left the loop to its caller, and `theokit start`
 * never wrote one, so jobs were enqueued into a backend nothing drained (usetheokit/theokit#1010).
 * This is that loop, shared by `theokit start`, `theokit dev` and anyone running a worker process
 * of their own:
 *
 * - a tick that leased jobs is followed by another at once, so a backlog drains at full speed;
 * - an empty tick waits `pollIntervalMs` before asking again;
 * - a tick that throws (the database is down) is logged and retried with exponential backoff
 *   capped at `maxErrorBackoffMs`, so an outage neither kills the process nor spins;
 * - `stop()` lets the tick in progress finish (its jobs are acked or nacked) and resolves after it.
 *   A wait in progress is cut short.
 */
export interface JobWorkerOptions {
  /** Wait after a tick that leased nothing. Default 1000 ms. */
  pollIntervalMs?: number
  /** Leases per tick, passed to `tick()`. Default 10. */
  batchSize?: number
  /** Lease duration per job, passed to `tick()`. Default 30 s. */
  lockSeconds?: number
  /** Ceiling of the backoff after consecutive failed ticks. Default 30 000 ms. */
  maxErrorBackoffMs?: number
}

export interface JobWorker {
  /** Start polling. A second call is a no-op. */
  start(): void
  /** Stop polling; resolves once the tick in progress, if any, has finished. */
  stop(): Promise<void>
}

const workerLogger = createLogger({ context: { component: 'theokit:jobs:worker' } })

export function createJobWorker(runner: JobRunner, options: JobWorkerOptions = {}): JobWorker {
  const pollIntervalMs = options.pollIntervalMs ?? 1000
  const maxErrorBackoffMs = options.maxErrorBackoffMs ?? 30_000
  const tickOptions = { batchSize: options.batchSize ?? 10, lockSeconds: options.lockSeconds ?? 30 }

  let running = false
  let loop: Promise<void> | undefined
  let wake: (() => void) | undefined

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(done, ms)
      function done(): void {
        clearTimeout(timer)
        wake = undefined
        resolve()
      }
      wake = done
    })

  const run = async (): Promise<void> => {
    let failures = 0
    while (running) {
      try {
        const leased = await runner.tick(tickOptions)
        failures = 0
        if (leased > 0) continue
        await wait(pollIntervalMs)
      } catch (err) {
        failures++
        const delayMs = Math.min(pollIntervalMs * 2 ** failures, maxErrorBackoffMs)
        workerLogger.error('job worker tick failed; retrying', {
          error: err instanceof Error ? err.message : String(err),
          consecutiveFailures: failures,
          retryInMs: delayMs,
        })
        await wait(delayMs)
      }
    }
  }

  return {
    start() {
      if (running) return
      running = true
      loop = run()
    },
    async stop() {
      running = false
      wake?.()
      await loop
      loop = undefined
    },
  }
}
