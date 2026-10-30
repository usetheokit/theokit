import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defineJob } from '../../packages/theo/src/server/jobs/define-job.js'
import { JobLeaseLostError } from '../../packages/theo/src/server/jobs/job-backend.js'
import { InMemoryJobBackend } from '../../packages/theo/src/server/jobs/job-backend-memory.js'
import { createJobRunner } from '../../packages/theo/src/server/jobs/job-runner.js'

/**
 * A lease is fenced by its token (usetheokit/theokit#1012). A worker whose lease expired and was
 * handed to another worker must not be able to finish the job on the new holder's behalf: its ack
 * would delete a job that is still running, and its nack would release or drop a lease it no longer
 * holds.
 */

let backend: InMemoryJobBackend

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-30T12:00:00.000Z'))
  backend = new InMemoryJobBackend()
})

afterEach(() => {
  backend.destroy()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const expireLease = (): void => {
  vi.setSystemTime(Date.now() + 2_000)
}

describe('InMemoryJobBackend fences ack and nack by lease token (#1012)', () => {
  it('test_every_lease_carries_a_token_and_a_re_lease_gets_a_new_one', async () => {
    await backend.enqueue({ name: 'slow', input: {}, maxAttempts: 5 })
    const [a] = await backend.dequeue({ lockSeconds: 1 })
    expireLease()
    const [b] = await backend.dequeue({ lockSeconds: 60 })

    expect(a.leaseToken).toEqual(expect.any(String))
    expect(b.leaseToken).toEqual(expect.any(String))
    expect(b.leaseToken).not.toBe(a.leaseToken)
  })

  it('test_a_stale_ack_is_refused_and_the_current_holder_can_still_ack', async () => {
    const { jobId } = await backend.enqueue({ name: 'slow', input: {}, maxAttempts: 5 })
    const [a] = await backend.dequeue({ lockSeconds: 1 })
    expireLease()
    const [b] = await backend.dequeue({ lockSeconds: 60 })

    await expect(backend.ack(jobId, { leaseToken: a.leaseToken })).rejects.toBeInstanceOf(
      JobLeaseLostError,
    )
    await backend.ack(jobId, { leaseToken: b.leaseToken })
    expireLease()
    expireLease()
    expect(await backend.dequeue({ lockSeconds: 60 })).toEqual([])
  })

  it('test_a_stale_nack_is_refused_and_does_not_release_the_current_lease', async () => {
    const { jobId } = await backend.enqueue({ name: 'slow', input: {}, maxAttempts: 5 })
    const [a] = await backend.dequeue({ lockSeconds: 1 })
    expireLease()
    await backend.dequeue({ lockSeconds: 60 })

    await expect(
      backend.nack(jobId, { error: 'late', leaseToken: a.leaseToken }),
    ).rejects.toBeInstanceOf(JobLeaseLostError)
    expect(await backend.dequeue({ lockSeconds: 60 })).toEqual([])
  })

  it('test_a_late_ack_succeeds_when_nobody_re_leased_the_job', async () => {
    const { jobId } = await backend.enqueue({ name: 'slow', input: {} })
    const [a] = await backend.dequeue({ lockSeconds: 1 })
    expireLease()

    await expect(backend.ack(jobId, { leaseToken: a.leaseToken })).resolves.toBeUndefined()
  })
})

describe('the runner reports a lost lease instead of finishing the new holder’s job (#1012)', () => {
  it('test_a_handler_that_outlives_its_lease_does_not_ack_the_re_leased_job', async () => {
    const warn = vi.spyOn(console, 'log').mockImplementation(() => {})
    let secondLease: string | undefined
    const slow = defineJob('slow', {
      maxAttempts: 5,
      async handler() {
        // While this handler runs, its lease expires and another worker takes the job.
        expireLease()
        const [b] = await backend.dequeue({ lockSeconds: 60 })
        secondLease = b.leaseToken
      },
    })
    const { jobId } = await backend.enqueue({ name: 'slow', input: {}, maxAttempts: 5 })

    await createJobRunner(backend, [slow]).tick({ lockSeconds: 1 })

    // The second worker still holds the job and can finish it.
    await expect(backend.ack(jobId, { leaseToken: secondLease })).resolves.toBeUndefined()
    const logged = warn.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    expect(logged).toContainEqual(
      expect.objectContaining({ level: 'warn', jobId, outcome: 'ack', code: 'JOB_LEASE_LOST' }),
    )
  })
})
