import { describe, expect, it, vi } from 'vitest'

import { InMemoryJobBackend } from '../../packages/theo/src/server/jobs/job-backend-memory.js'
import type { JobBackend } from '../../packages/theo/src/server/jobs/job-backend.js'
import { createOutbox } from '../../packages/theo/src/server/jobs/outbox.js'
import {
  createQueueClient,
  TransactionalEnqueueUnsupportedError,
} from '../../packages/theo/src/server/jobs/queue-client.js'
import type { PoolLike } from '../../packages/theo/src/server/storage/storage-types.js'

/**
 * `ctx.queue.enqueueInTransaction(client, ...)` writes the job through the caller's connection, so
 * it commits with the caller's rows (usetheokit/theokit#1077). The commit semantics are asserted
 * against real Postgres in `job-backend-postgres-real.test.ts`; this pins the client's half: it goes
 * straight to the backend with the caller's connection, skips the per-request outbox, and refuses
 * a backend that cannot join a transaction instead of enqueueing outside it.
 */
const client: PoolLike = { query: () => Promise.resolve({ rows: [] }) }

function transactionalBackend(): JobBackend & {
  enqueueInTransaction: ReturnType<typeof vi.fn>
} {
  return {
    name: 'fake-postgres',
    enqueue: vi.fn(() => Promise.resolve({ jobId: 'outside' })),
    dequeue: () => Promise.resolve([]),
    ack: () => Promise.resolve(),
    nack: () => Promise.resolve(),
    enqueueInTransaction: vi.fn(() => Promise.resolve({ jobId: 'inside' })),
  }
}

describe('QueueClient.enqueueInTransaction', () => {
  it('test_writes_the_job_through_the_callers_connection_and_skips_the_outbox', async () => {
    const backend = transactionalBackend()
    const outbox = createOutbox()
    const queue = createQueueClient(backend, outbox, { traceparent: '00-abc-def-01' })

    const result = await queue.enqueueInTransaction(client, 'process-task' as never, {} as never, {
      idempotencyKey: 'delivery-1',
      delaySeconds: 5,
    })

    expect(result).toEqual({ jobId: 'inside' })
    expect(backend.enqueueInTransaction).toHaveBeenCalledWith(client, {
      name: 'process-task',
      input: {},
      idempotencyKey: 'delivery-1',
      delaySeconds: 5,
      traceparent: '00-abc-def-01',
    })
    expect(backend.enqueue).not.toHaveBeenCalled()
    expect(outbox.size()).toBe(0)
  })

  it('test_refuses_a_backend_that_cannot_join_the_transaction', async () => {
    const backend = new InMemoryJobBackend()
    const enqueue = vi.spyOn(backend, 'enqueue')
    const queue = createQueueClient(backend, createOutbox())
    try {
      const attempt = queue.enqueueInTransaction(client, 'process-task' as never, {} as never)
      await expect(attempt).rejects.toBeInstanceOf(TransactionalEnqueueUnsupportedError)
      await expect(attempt).rejects.toMatchObject({ code: 'TRANSACTIONAL_ENQUEUE_UNSUPPORTED' })
      await expect(attempt).rejects.toThrow(/memory/)
      expect(enqueue).not.toHaveBeenCalled()
    } finally {
      backend.destroy()
    }
  })
})
