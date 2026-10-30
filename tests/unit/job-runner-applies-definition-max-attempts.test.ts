import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { defineJob } from '../../packages/theo/src/server/jobs/define-job.js'
import { InMemoryJobBackend } from '../../packages/theo/src/server/jobs/job-backend-memory.js'
import { createJobRunner } from '../../packages/theo/src/server/jobs/job-runner.js'
import { createOutbox } from '../../packages/theo/src/server/jobs/outbox.js'
import {
  createOutboxDispatcher,
  createQueueClient,
} from '../../packages/theo/src/server/jobs/queue-client.js'

/**
 * `defineJob('flaky', { maxAttempts: 3 })` was never retried when enqueued through the queue client
 * (`ctx.queue`): the client has no access to the definitions, the entry carried no `maxAttempts`,
 * and the backend stored its default of 1, so the first failure was final
 * (usetheokit/theokit#1013). The runner holds the definitions, so it applies `maxAttempts` when it
 * decides retry versus final.
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
})

describe('a job enqueued through the queue client gets its definition’s maxAttempts (#1013)', () => {
  it('test_a_flaky_job_with_max_attempts_three_runs_three_times', async () => {
    let calls = 0
    const flaky = defineJob('flaky', {
      maxAttempts: 3,
      handler() {
        calls++
        throw new Error(`boom ${String(calls)}`)
      },
    })
    const outbox = createOutbox()
    createQueueClient(backend, outbox).enqueue('flaky' as never, { x: 1 } as never)
    await outbox.flush(createOutboxDispatcher(backend))
    const runner = createJobRunner(backend, [flaky])

    for (let i = 0; i < 5; i++) {
      // Far enough to clear any retry backoff the backend applies.
      vi.setSystemTime(Date.now() + 3_600_000)
      await runner.tick()
    }

    expect(calls).toBe(3)
  })
})
