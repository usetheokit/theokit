import { afterEach, describe, expect, it } from 'vitest'

import { InMemoryJobBackend } from '../../packages/theo/src/server/jobs/job-backend-memory.js'

/**
 * `PostgresJobBackend` deduplicates on (name, idempotency_key), its unique index. The in-memory
 * backend keyed on the idempotency key alone, so a dev run against it merged two job types that
 * share a key while production kept them apart, and `idempotency(key)` could return another job
 * type's id (usetheokit/theokit#1015).
 */

let backend: InMemoryJobBackend | undefined

afterEach(() => {
  backend?.destroy()
})

describe('InMemoryJobBackend scopes an idempotency key to the job name (#1015)', () => {
  it('test_two_job_types_with_the_same_key_are_two_jobs', async () => {
    backend = new InMemoryJobBackend()
    const charge = await backend.enqueue({ name: 'charge', input: {}, idempotencyKey: 'k-1' })
    const email = await backend.enqueue({ name: 'email', input: {}, idempotencyKey: 'k-1' })
    const again = await backend.enqueue({ name: 'charge', input: {}, idempotencyKey: 'k-1' })

    expect(email.jobId).not.toBe(charge.jobId)
    expect(again.jobId).toBe(charge.jobId)
  })

  it('test_the_lookup_with_a_name_returns_that_job_type_only', async () => {
    backend = new InMemoryJobBackend()
    const charge = await backend.enqueue({ name: 'charge', input: {}, idempotencyKey: 'k-1' })
    const email = await backend.enqueue({ name: 'email', input: {}, idempotencyKey: 'k-1' })

    expect(await backend.idempotency('k-1', 60, 'email')).toEqual({ jobId: email.jobId })
    expect(await backend.idempotency('k-1', 60, 'charge')).toEqual({ jobId: charge.jobId })
    expect(await backend.idempotency('k-1', 60, 'other')).toBeNull()
  })
})
