import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defineJob } from '../../packages/theo/src/server/jobs/define-job.js'
import {
  type JobBackend,
  JobLeaseLostError,
} from '../../packages/theo/src/server/jobs/job-backend.js'
import { InMemoryJobBackend } from '../../packages/theo/src/server/jobs/job-backend-memory.js'
import { createJobRunner } from '../../packages/theo/src/server/jobs/job-runner.js'
import type { JobContext } from '../../packages/theo/src/server/jobs/job-types.js'

/**
 * A handler could not extend its lease, and `lockSeconds` is one value for the whole worker, so a
 * job that may run for 30 minutes forced a one-hour lock on every job, and a worker that crashed
 * left its job unavailable for that hour (usetheokit/theokit#1132).
 *
 * `ctx.extendLease()` lets a handler that is still making progress keep the job, and moves the
 * deadline of `ctx.signal` with it.
 */

let backend: InMemoryJobBackend

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-03T12:00:00.000Z'))
  backend = new InMemoryJobBackend()
})

afterEach(() => {
  backend.destroy()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const seconds = (n: number) => vi.advanceTimersByTimeAsync(n * 1000)

/** A job whose handler waits until the test lets it finish, and hands the test its context. */
function parkedJob() {
  let release!: () => void
  const parked = new Promise<void>((resolve) => (release = resolve))
  const seen: { ctx?: JobContext } = {}
  const job = defineJob('long', {
    maxAttempts: 1,
    async handler(ctx) {
      seen.ctx = ctx
      await parked
    },
  })
  return { job, seen, release }
}

describe('InMemoryJobBackend.extendLease', () => {
  it('test_it_moves_the_lock_forward_and_returns_the_new_deadline', async () => {
    await backend.enqueue({ name: 'long', input: {} })
    const [lease] = await backend.dequeue({ lockSeconds: 1 })

    const until = await backend.extendLease(lease.jobId, {
      leaseToken: lease.leaseToken!,
      lockSeconds: 10,
    })

    expect(until.getTime()).toBe(Date.now() + 10_000)
    await seconds(5)
    expect(await backend.dequeue({ lockSeconds: 1 })).toEqual([]) // still held, past the first lock
  })

  it('test_a_lease_that_was_re_leased_cannot_be_extended', async () => {
    await backend.enqueue({ name: 'long', input: {}, maxAttempts: 3 })
    const [stale] = await backend.dequeue({ lockSeconds: 1 })
    await seconds(2)
    const [current] = await backend.dequeue({ lockSeconds: 60 })

    const attempt = backend.extendLease(stale.jobId, {
      leaseToken: stale.leaseToken!,
      lockSeconds: 99,
    })
    await expect(attempt).rejects.toBeInstanceOf(JobLeaseLostError)
    await expect(attempt).rejects.toMatchObject({ operation: 'extend' })

    // The current holder's lock is untouched: it still expires at its own 60 seconds.
    await seconds(61)
    expect(current.leaseToken).toBeDefined()
    expect((await backend.dequeue({ lockSeconds: 1 })).length).toBe(1)
  })

  it('test_a_job_that_is_gone_cannot_be_extended', async () => {
    const { jobId } = await backend.enqueue({ name: 'long', input: {} })
    const [lease] = await backend.dequeue({ lockSeconds: 5 })
    await backend.ack(jobId, { leaseToken: lease.leaseToken })

    await expect(
      backend.extendLease(jobId, { leaseToken: lease.leaseToken!, lockSeconds: 5 }),
    ).rejects.toBeInstanceOf(JobLeaseLostError)
  })
})

describe('ctx.extendLease in a handler', () => {
  it('test_without_it_the_signal_aborts_when_the_lock_runs_out', async () => {
    await backend.enqueue({ name: 'long', input: {} })
    const { job, seen, release } = parkedJob()
    const tick = createJobRunner(backend, [job]).tick({ lockSeconds: 1 })

    await seconds(1.1)
    expect(seen.ctx?.signal.aborted).toBe(true)
    release()
    await tick
  })

  it('test_extending_keeps_the_job_and_moves_the_signal_deadline', async () => {
    await backend.enqueue({ name: 'long', input: {} })
    const { job, seen, release } = parkedJob()
    const tick = createJobRunner(backend, [job]).tick({ lockSeconds: 1 })

    await seconds(0.9)
    await seen.ctx!.extendLease(10) // 10 s from now
    await seconds(5) // well past the original 1 s
    expect(seen.ctx?.signal.aborted).toBe(false)
    expect(await backend.dequeue({ lockSeconds: 1 })).toEqual([]) // no other worker can take it

    release()
    await tick
    await seconds(60)
    expect(await backend.dequeue({ lockSeconds: 1 })).toEqual([]) // acked, not retried
  })

  it('test_the_signal_still_aborts_when_the_extended_lock_runs_out', async () => {
    await backend.enqueue({ name: 'long', input: {} })
    const { job, seen, release } = parkedJob()
    const tick = createJobRunner(backend, [job]).tick({ lockSeconds: 1 })

    await seconds(0.5)
    await seen.ctx!.extendLease(3)
    await seconds(2.9)
    expect(seen.ctx?.signal.aborted).toBe(false)
    await seconds(0.2)
    expect(seen.ctx?.signal.aborted).toBe(true)
    release()
    await tick
  })

  it('test_without_an_argument_it_extends_by_the_lock_the_worker_leased_with', async () => {
    await backend.enqueue({ name: 'long', input: {} })
    const { job, seen, release } = parkedJob()
    const tick = createJobRunner(backend, [job]).tick({ lockSeconds: 4 })

    await seconds(3)
    await seen.ctx!.extendLease() // 4 s from now: until t = 7 s
    await seconds(3.5) // t = 6.5 s, past the original t = 4 s
    expect(seen.ctx?.signal.aborted).toBe(false)
    release()
    await tick
  })

  it('test_a_lost_lease_aborts_the_signal_and_rejects_the_call', async () => {
    await backend.enqueue({ name: 'long', input: {}, maxAttempts: 3 })
    const { job, seen, release } = parkedJob()
    const tick = createJobRunner(backend, [job]).tick({ lockSeconds: 1 })

    await seconds(1.5) // the lock ran out and another worker takes the job
    await backend.dequeue({ lockSeconds: 60 })

    await expect(seen.ctx!.extendLease(10)).rejects.toBeInstanceOf(JobLeaseLostError)
    expect(seen.ctx?.signal.aborted).toBe(true)
    release()
    await tick
  })

  it('test_a_backend_that_cannot_extend_says_so', async () => {
    const inner = new InMemoryJobBackend()
    const noExtend: JobBackend = {
      name: 'no-extend',
      enqueue: (i) => inner.enqueue(i),
      dequeue: (o) => inner.dequeue(o),
      ack: (id, f) => inner.ack(id, f),
      nack: (id, o) => inner.nack(id, o),
    }
    await noExtend.enqueue({ name: 'long', input: {} })
    const { job, seen, release } = parkedJob()
    const tick = createJobRunner(noExtend, [job]).tick({ lockSeconds: 30 })

    await seconds(1)
    await expect(seen.ctx!.extendLease(10)).rejects.toMatchObject({
      code: 'JOB_LEASE_EXTENSION_UNSUPPORTED',
    })
    release()
    await tick
    inner.destroy()
  })
})
