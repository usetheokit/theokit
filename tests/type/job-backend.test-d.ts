import { describe, it, expectTypeOf } from 'vitest'

import { defineCron } from '../../packages/theo/src/server/cron/define-cron.js'
import { defineJob } from '../../packages/theo/src/server/jobs/define-job.js'
import type {
  JobBackend,
  JobEnqueueInput,
  JobLease,
} from '../../packages/theo/src/server/jobs/job-backend.js'
import type { JobContext } from '../../packages/theo/src/server/jobs/job-types.js'
import type { JobRegistry } from '../../packages/theo/src/server/jobs/job-types.js'
import type { QueueClient } from '../../packages/theo/src/server/jobs/queue-client.js'

// User-side module augmentation example.
declare module '../../packages/theo/src/server/jobs/job-types.js' {
  interface JobRegistry {
    'process-document': { documentId: string }
    'send-email': { to: string; subject: string }
  }
}

describe('JobBackend types (T2.1)', () => {
  it('JobBackend interface has expected method shape', () => {
    expectTypeOf<JobBackend>().toExtend<{
      readonly name: string
      enqueue: (input: JobEnqueueInput) => Promise<{ jobId: string }>
      dequeue: (opts: { batchSize?: number; lockSeconds?: number }) => Promise<JobLease[]>
      ack: (jobId: string) => Promise<void>
      nack: (jobId: string, opts: { error: string; nonRetryable?: boolean }) => Promise<void>
    }>()
  })

  it('JobEnqueueInput requires name + input', () => {
    expectTypeOf<JobEnqueueInput>().toExtend<{
      name: string
      input: unknown
    }>()
  })

  it('JobLease includes lockExpiresAt as Date', () => {
    expectTypeOf<JobLease['lockExpiresAt']>().toEqualTypeOf<Date>()
  })

  it('JobRegistry augmentation extends the type map', () => {
    type ProcessInput = JobRegistry['process-document']
    expectTypeOf<ProcessInput>().toEqualTypeOf<{ documentId: string }>()
  })
})

describe('JobContext.queue', () => {
  it('is the typed QueueClient', () => {
    expectTypeOf<JobContext['queue']>().toEqualTypeOf<QueueClient>()
  })
})

describe('handler queue accepts only registered jobs', () => {
  it('job handler ctx.queue checks names and inputs', () => {
    defineJob('fan-out', {
      handler: (ctx) => {
        ctx.queue.enqueue('send-email', { to: 'a@b.c', subject: 's' })
        // @ts-expect-error unknown job name
        ctx.queue.enqueue('nope', {})
        // @ts-expect-error wrong input shape
        ctx.queue.enqueue('send-email', { documentId: 'x' })
      },
    })
  })

  it('cron handler ctx.queue checks names and inputs', () => {
    defineCron('probe', {
      schedule: '* * * * *',
      handler: (ctx) => {
        ctx.queue.enqueue('process-document', { documentId: 'd' })
        // @ts-expect-error unknown job name
        ctx.queue.enqueue('nope', {})
        // @ts-expect-error wrong input shape
        ctx.queue.enqueue('process-document', { to: 'x' })
      },
    })
  })
})
