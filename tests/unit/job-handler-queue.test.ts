import { describe, it, expect, vi } from 'vitest'

import type { JobBackend, JobLease } from '../../packages/theo/src/server/jobs/job-backend.js'
import { createJobRunner } from '../../packages/theo/src/server/jobs/job-runner.js'
import { defineJob } from '../../packages/theo/src/server/jobs/define-job.js'

function setup(handler: (ctx: any) => void | Promise<void>) {
  const lease: JobLease = {
    jobId: 'j1',
    name: 'parent',
    input: {},
    attempts: 1,
    lockExpiresAt: new Date(Date.now() + 60_000),
    traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
  } as JobLease
  const enqueue = vi.fn(async () => ({ jobId: 'child' }))
  const enqueueInTransaction = vi.fn(async () => ({ jobId: 'tx' }))
  const backend = {
    name: 'fake',
    enqueue,
    enqueueInTransaction,
    dequeue: vi.fn(async () => [lease]),
    ack: vi.fn(async () => {}),
    nack: vi.fn(async () => {}),
  } as unknown as JobBackend
  const runner = createJobRunner(backend, [defineJob('parent', { handler })])
  return { runner, backend, enqueue, enqueueInTransaction }
}

describe('ctx.queue in a job handler', () => {
  it('dispatches buffered jobs after the handler returns, with the job trace', async () => {
    const { runner, enqueue, backend } = setup((ctx) => {
      ctx.queue.enqueue('child', { a: 1 }, { idempotencyKey: 'k' })
      expect(enqueue).not.toHaveBeenCalled()
    })
    await runner.tick()
    expect(enqueue).toHaveBeenCalledTimes(1)
    const entry = (enqueue.mock.calls[0] as unknown as [any])[0]
    expect(entry).toMatchObject({ name: 'child', input: { a: 1 }, idempotencyKey: 'k' })
    expect(entry.traceparent).toMatch(/^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/)
    expect(backend.ack).toHaveBeenCalled()
  })

  it('drops buffered jobs when the handler throws', async () => {
    const { runner, enqueue, backend } = setup((ctx) => {
      ctx.queue.enqueue('child', {})
      throw new Error('boom')
    })
    await runner.tick()
    expect(enqueue).not.toHaveBeenCalled()
    expect(backend.nack).toHaveBeenCalled()
  })

  it('forwards enqueueInTransaction to the backend', async () => {
    const client = {}
    const { runner, enqueueInTransaction } = setup(async (ctx) => {
      await ctx.queue.enqueueInTransaction(client, 'child', { a: 1 }, { idempotencyKey: 'x' })
    })
    await runner.tick()
    expect(enqueueInTransaction).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ name: 'child', idempotencyKey: 'x' }),
    )
  })
})
