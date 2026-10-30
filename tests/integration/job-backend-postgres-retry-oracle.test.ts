import { describe, it, expect, beforeEach } from 'vitest'
// pg-mem is an in-memory Postgres: these cases run on every `vitest run`, inside the required CI
// check, where the real-Postgres file only runs in its own non-required job.
import { DataType, newDb } from 'pg-mem'

import {
  PostgresJobBackend,
  type PoolLike,
} from '../../packages/theo/src/server/jobs/job-backend-postgres.js'
import type { JobNackOptions } from '../../packages/theo/src/server/jobs/job-backend.js'
import {
  RETRY_IMMEDIATELY,
  assertQueuedJobIsRetriedToItsDefinitionMaxAttempts,
} from './helpers/queued-job-retry-oracle.js'

// B-666 — the #1013 test (job-backend-postgres-real.test.ts) calls the same oracle against a real
// Postgres. Here it runs against the current backend and against two mutants, each a subclass that
// changes one input of the retry decision (job-backend-postgres.ts `nack`), so no production line
// is edited to prove the oracle can fail.

/** Forced-final mutant: every nack passes `nonRetryable: true`, so the first failure is final. */
class ForcedFinal extends PostgresJobBackend {
  override nack(jobId: string, opts: JobNackOptions): Promise<void> {
    return super.nack(jobId, { ...opts, nonRetryable: true })
  }
}

/**
 * The #1013 bug state: the definition's `maxAttempts` never reaches the backend, so the decision
 * falls back to the stored `max_attempts` 1. Only the `nack` override changes behaviour here: the
 * queue client never passes `maxAttempts` to `enqueue`, so that override adds no coverage and is
 * kept only to mirror the #1013 code.
 */
class Bug1013 extends PostgresJobBackend {
  override enqueue(input: Parameters<PostgresJobBackend['enqueue']>[0]) {
    return super.enqueue({ ...input, maxAttempts: undefined })
  }
  override nack(jobId: string, opts: JobNackOptions): Promise<void> {
    return super.nack(jobId, { ...opts, maxAttempts: undefined })
  }
}

const TABLE = 'theokit_jobs'
let pool: PoolLike

beforeEach(() => {
  const db = newDb({ noAstCoverageCheck: true } as never)
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.text,
    implementation: () => Math.random().toString(16).slice(2),
  })
  pool = new (db.adapters.createPg() as { Pool: new () => PoolLike }).Pool()
})

async function migrated<T extends PostgresJobBackend>(backend: T): Promise<T> {
  await backend.migrate()
  return backend
}

describe('B-666 — the #1013 retry oracle rejects a backend whose first failure is final', () => {
  it('test_the_oracle_passes_on_the_current_backend', async () => {
    const backend = await migrated(
      new PostgresJobBackend({ pool, tableName: TABLE, ...RETRY_IMMEDIATELY }),
    )
    await assertQueuedJobIsRetriedToItsDefinitionMaxAttempts({ backend, pool, table: TABLE })
  })

  it('test_the_oracle_rejects_a_backend_whose_every_nack_is_final', async () => {
    const backend = await migrated(
      new ForcedFinal({ pool, tableName: TABLE, ...RETRY_IMMEDIATELY }),
    )
    await expect(
      assertQueuedJobIsRetriedToItsDefinitionMaxAttempts({ backend, pool, table: TABLE }),
    ).rejects.toThrow(/still pending after attempt 1/)
  })

  it('test_the_oracle_rejects_the_1013_bug_state_where_nack_ignores_the_definition_max_attempts', async () => {
    const backend = await migrated(new Bug1013({ pool, tableName: TABLE, ...RETRY_IMMEDIATELY }))
    await expect(
      assertQueuedJobIsRetriedToItsDefinitionMaxAttempts({ backend, pool, table: TABLE }),
    ).rejects.toThrow(/still pending after attempt 1/)
  })
})
