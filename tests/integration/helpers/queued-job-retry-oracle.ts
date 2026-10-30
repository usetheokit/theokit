import { expect } from 'vitest'

import { defineJob } from '../../../packages/theo/src/server/jobs/define-job.js'
import { createJobRunner } from '../../../packages/theo/src/server/jobs/job-runner.js'
import { createOutbox } from '../../../packages/theo/src/server/jobs/outbox.js'
import {
  createOutboxDispatcher,
  createQueueClient,
} from '../../../packages/theo/src/server/jobs/queue-client.js'
import type {
  PoolLike,
  PostgresJobBackend,
} from '../../../packages/theo/src/server/jobs/job-backend-postgres.js'

/** Spread into a `PostgresJobBackend`'s options so a retried job is due again on the next tick. */
export const RETRY_IMMEDIATELY = { retryDelaySeconds: (): number => 0 }

export interface QueuedJobRetryOracleInput {
  backend: PostgresJobBackend
  pool: PoolLike
  /** The backend's table; passed by the test, never taken from input. */
  table: string
}

/**
 * The #1013 oracle: a job enqueued through the queue client is retried up to its definition's
 * `maxAttempts` (3), not failed on its first error.
 *
 * Since #1014 a final failure keeps its row, so `attempts = 1` after one tick holds for a backend
 * whose first failure is final too (B-666). The oracle therefore asserts the row is still pending
 * after attempt 1, failed only after attempt 3, and never run a fourth time. While #1014 keeps
 * failed rows, the pending check is the first assertion a final-first-failure backend can fail,
 * and its message names it; a backend that deleted the row would fail the one-row check instead.
 *
 * The caller builds `backend` with `RETRY_IMMEDIATELY` so each retry is due on the next tick.
 */
export async function assertQueuedJobIsRetriedToItsDefinitionMaxAttempts({
  backend,
  pool,
  table,
}: QueuedJobRetryOracleInput): Promise<void> {
  let calls = 0
  const flaky = defineJob('flaky', {
    maxAttempts: 3,
    handler() {
      calls++
      throw new Error(`boom ${String(calls)}`)
    },
  })
  const outbox = createOutbox()
  const idP = createQueueClient(backend, outbox).enqueueWithId('flaky' as never, {} as never)
  await outbox.flush(createOutboxDispatcher(backend))
  const { jobId } = await idP
  const runner = createJobRunner(backend, [flaky])
  const readRow = async (): Promise<{ attempts: number; failed_at: unknown }> => {
    const { rows } = await pool.query<{ attempts: number; failed_at: unknown }>(
      `SELECT attempts, failed_at FROM ${table} WHERE id = $1`,
      [jobId],
    )
    expect(rows, `job ${jobId} has exactly one row in ${table}`).toHaveLength(1)
    return rows[0]!
  }

  await runner.tick()
  expect(calls, 'the handler ran once on the first tick').toBe(1)
  expect(
    (await readRow()).failed_at,
    'job is still pending after attempt 1 (failed_at IS NULL)',
  ).toBeNull()

  await runner.tick()
  await runner.tick()
  expect(calls, 'the handler ran three times, once per attempt').toBe(3)
  const exhausted = await readRow()
  expect(exhausted.attempts, 'attempts reached the definition maxAttempts 3').toBe(3)
  expect(
    exhausted.failed_at,
    'job is failed after attempt 3 (failed_at IS NOT NULL)',
  ).not.toBeNull()

  expect(await runner.tick(), 'a failed job is never leased a fourth time').toBe(0)
  expect(calls, 'the handler never ran a fourth time').toBe(3)
}
