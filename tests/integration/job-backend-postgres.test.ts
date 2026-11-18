import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// pg-mem is an in-memory Postgres for tests — avoids docker/testcontainers.
// Real-Postgres CI tests can extend this fixture with a connection string.
import { DataType, newDb, type IBackup, type IMemoryDb } from 'pg-mem'

import {
  PostgresJobBackend,
  type PoolLike as ProdPoolLike,
} from '../../packages/theo/src/server/jobs/job-backend-postgres.js'

// Test pool shape matches the production interface (generic query<R>).
type PoolLike = ProdPoolLike & { end?: () => Promise<void> }

let db: IMemoryDb
let backup: IBackup
let pool: PoolLike
let backend: PostgresJobBackend

beforeEach(async () => {
  // noAstCoverageCheck: pg-mem treats unknown AST nodes (PRIMARY KEY,
  // FOR UPDATE SKIP LOCKED) as fatal by default. We don't need those
  // features executed correctly in pg-mem — the real-Postgres CI run
  // verifies SKIP LOCKED behavior. For unit tests, suppressing the
  // strict check lets us exercise the SQL shape end-to-end.
  db = newDb({ noAstCoverageCheck: true } as never)
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: DataType.text,
    implementation: () =>
      `${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 6)}-${Math.random().toString(16).slice(2, 14)}`,
  })
  const adapters = db.adapters.createPg() as { Pool: new () => PoolLike }
  pool = new adapters.Pool()
  backend = new PostgresJobBackend({ pool })
  await backend.migrate()
  backup = db.backup()
})

afterEach(() => {
  backup.restore()
})

describe('PostgresJobBackend (T3.1)', () => {
  it('enqueue inserts a row', async () => {
    const { jobId } = await backend.enqueue({ name: 'test', input: { a: 1 } })
    expect(typeof jobId).toBe('string')

    const r = await pool.query('SELECT * FROM theokit_jobs WHERE id = $1', [jobId])
    expect(r.rows.length).toBe(1)
  })

  it('dequeue marks lease as locked', async () => {
    await backend.enqueue({ name: 'test', input: {} })
    const leases = await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
    expect(leases.length).toBe(1)
    expect(leases[0].lockExpiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  // pg-mem does not fully implement SKIP LOCKED — it ignores the directive
  // and lets concurrent SELECTs see the same row before either commits.
  // Real Postgres serializes properly. Here we verify the SEQUENTIAL
  // contract: after one dequeue locks a row, the next dequeue sees it
  // as locked and skips it. Real concurrent safety is covered by the
  // CI integration test against a live Postgres (deferred per ADR-0002 / T3.1).
  it('sequential dequeue respects locked_until (real Postgres adds SKIP LOCKED safety)', async () => {
    await backend.enqueue({ name: 'test', input: {} })
    const a = await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
    const b = await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
    expect(a.length).toBe(1)
    expect(b.length).toBe(0)
  })

  it('idempotency UNIQUE index dedups same (name, key)', async () => {
    const first = await backend.enqueue({
      name: 'test',
      input: {},
      idempotencyKey: 'unique-1',
    })
    const dup = await backend.enqueue({
      name: 'test',
      input: {},
      idempotencyKey: 'unique-1',
    })
    expect(dup.jobId).toBe(first.jobId)
  })

  it('ack removes the row', async () => {
    const { jobId } = await backend.enqueue({ name: 'test', input: {} })
    await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
    await backend.ack(jobId)
    const r = await pool.query('SELECT * FROM theokit_jobs WHERE id = $1', [jobId])
    expect(r.rows.length).toBe(0)
  })

  it('nack with nonRetryable keeps the row as failed with its error (#1014)', async () => {
    const { jobId } = await backend.enqueue({ name: 'test', input: {} })
    await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
    await backend.nack(jobId, { error: 'fatal', nonRetryable: true })
    const r = await pool.query<{ last_error: string; failed_at: unknown }>(
      'SELECT last_error, failed_at FROM theokit_jobs WHERE id = $1',
      [jobId],
    )
    expect(r.rows[0].last_error).toBe('fatal')
    expect(r.rows[0].failed_at).not.toBeNull()
  })

  it('nack without nonRetryable releases lock (re-dequeueable)', async () => {
    const { jobId } = await backend.enqueue({
      name: 'test',
      input: {},
      maxAttempts: 3,
    })
    await backend.dequeue({ batchSize: 1, lockSeconds: 30 })
    await backend.nack(jobId, { error: 'transient' })

    const r = await pool.query<{ locked_until: unknown }>(
      'SELECT locked_until FROM theokit_jobs WHERE id = $1',
      [jobId],
    )
    expect((r.rows[0] as { locked_until: unknown }).locked_until).toBeNull()
  })

  it('backend.name === "postgres"', () => {
    expect(backend.name).toBe('postgres')
  })

  it('migrate() is idempotent (safe to call repeatedly)', async () => {
    const { jobId } = await backend.enqueue({ name: 'test', input: {}, maxAttempts: 3 })
    await backend.migrate()
    await backend.migrate()
    // Existing data survives re-migration (an aggregate query always returns
    // one row, so assert on the count value and the row itself).
    const r = await pool.query<{ id: string }>('SELECT id FROM theokit_jobs WHERE id = $1', [jobId])
    expect(r.rows.length).toBe(1)
    const c = await pool.query<{ c: string | number }>('SELECT COUNT(*) as c FROM theokit_jobs')
    expect(Number(c.rows[0].c)).toBe(1)
  })
})

describe('PostgresJobBackend defer, restore and reschedule', () => {
  // pg-mem cannot parse 'infinity', so `infinity` itself is not covered here; these tests use a far date.
  const FAR = new Date('2999-01-01T00:00:00Z')
  const availableAt = async (id: string): Promise<number> => {
    const r = await pool.query<{ available_at: Date | string }>(
      'SELECT available_at FROM theokit_jobs WHERE id = $1',
      [id],
    )
    return new Date(r.rows[0].available_at).getTime()
  }

  it('defers selected jobs and restores each to its own time', async () => {
    const a = await backend.enqueue({ name: 'run-task', input: { taskId: 2 }, delaySeconds: 10 })
    const b = await backend.enqueue({ name: 'run-task', input: { taskId: 3 }, delaySeconds: 20 })
    const c = await backend.enqueue({ name: 'run-task', input: { taskId: 4 } })
    const beforeA = await availableAt(a.jobId)
    const beforeB = await availableAt(b.jobId)
    const until = new Date(Date.now() + 3_600_000)
    const moved = await backend.defer(pool, { name: 'run-task', where: { taskId: [2, 3] }, until })
    expect(new Set(moved)).toEqual(new Set([a.jobId, b.jobId]))
    expect(await availableAt(a.jobId)).toBe(until.getTime())
    // A second defer keeps the first remembered time.
    await backend.defer(pool, { name: 'run-task', where: { taskId: [2] }, until })
    const restored = await backend.restore(pool, { name: 'run-task', where: { taskId: [2, 3] } })
    expect(restored.length).toBe(2)
    expect(await availableAt(a.jobId)).toBe(beforeA)
    expect(await availableAt(b.jobId)).toBe(beforeB)
    expect(await backend.restore(pool, { name: 'run-task' })).toEqual([])
    expect(c.jobId).toBeTruthy()
    // The job input is untouched.
    const r = await pool.query<{ input: unknown }>('SELECT input FROM theokit_jobs WHERE id = $1', [
      a.jobId,
    ])
    expect(r.rows[0].input).toEqual({ taskId: 2 })
  })

  it('skips a leased job', async () => {
    await backend.enqueue({ name: 'run-task', input: { taskId: 1 } })
    const [lease] = await backend.dequeue({})
    const moved = await backend.defer(pool, {
      name: 'run-task',
      until: new Date(Date.now() + 60_000),
    })
    expect(moved).toEqual([])
    expect(await backend.reschedule(pool, lease.jobId, { availableAt: new Date() })).toBe(false)
  })

  it('forgets the remembered time once a deferred job is claimed', async () => {
    const a = await backend.enqueue({ name: 'run-task', input: { taskId: 1 }, maxAttempts: 3 })
    await backend.defer(pool, { name: 'run-task', until: new Date(Date.now() - 1_000) })
    const [lease] = await backend.dequeue({})
    expect(lease.jobId).toBe(a.jobId)
    await backend.nack(a.jobId, { error: 'flaky', leaseToken: lease.leaseToken })
    const retryAt = await availableAt(a.jobId)
    const until = new Date(Date.now() + 3_600_000)
    await backend.defer(pool, { name: 'run-task', until })
    await backend.restore(pool, { name: 'run-task' })
    expect(await availableAt(a.jobId)).toBe(retryAt)
  })

  it('holds far in the future and restores', async () => {
    const a = await backend.enqueue({ name: 'run-task', input: { taskId: 1 } })
    const before = await availableAt(a.jobId)
    await backend.defer(pool, { name: 'run-task', until: FAR })
    expect(await backend.dequeue({})).toEqual([])
    await backend.restore(pool, { name: 'run-task' })
    expect(await availableAt(a.jobId)).toBe(before)
  })

  it('reschedules a pending job ahead of another', async () => {
    const a = await backend.enqueue({ name: 'run-task', input: {}, delaySeconds: 100 })
    const when = new Date(Date.now() - 5_000)
    expect(await backend.reschedule(pool, a.jobId, { availableAt: when })).toBe(true)
    expect(await availableAt(a.jobId)).toBe(when.getTime())
    expect((await backend.dequeue({})).map((l) => l.jobId)).toEqual([a.jobId])
  })

  it('places a job ahead of the selected pending jobs', async () => {
    const a = await backend.enqueue({ name: 'run-task', input: { taskId: 1 }, delaySeconds: 100 })
    const b = await backend.enqueue({ name: 'run-task', input: { taskId: 2 }, delaySeconds: 50 })
    const c = await backend.enqueue({ name: 'run-task', input: { taskId: 3 }, delaySeconds: 200 })
    const earliest = await availableAt(b.jobId)
    expect(
      await backend.reschedule(pool, a.jobId, {
        ahead: { name: 'run-task', where: { taskId: [2, 3] } },
      }),
    ).toBe(true)
    expect(await availableAt(a.jobId)).toBe(earliest - 1_000)
    expect(await availableAt(c.jobId)).toBeGreaterThan(earliest)
    // Never later than it already is, and nothing to be ahead of leaves it alone.
    const at = await availableAt(a.jobId)
    await backend.reschedule(pool, a.jobId, { ahead: { name: 'run-task', where: { taskId: [3] } } })
    expect(await availableAt(a.jobId)).toBe(at)
    await backend.reschedule(pool, a.jobId, { ahead: { name: 'none' } })
    expect(await availableAt(a.jobId)).toBe(at)
  })

  it('locks the selected jobs when reading the time to go ahead of, so a dequeue cannot lease them first', async () => {
    const a = await backend.enqueue({ name: 'run-task', input: { taskId: 1 }, delaySeconds: 100 })
    await backend.enqueue({ name: 'run-task', input: { taskId: 2 }, delaySeconds: 50 })
    const statements: string[] = []
    const recording: PoolLike = {
      query: ((sql: string, params?: unknown[]) => {
        statements.push(sql)
        return pool.query(sql, params)
      }) as PoolLike['query'],
    }
    await backend.reschedule(recording, a.jobId, {
      ahead: { name: 'run-task', where: { taskId: [2] } },
    })
    const read = statements.find((q) => q.includes('SELECT COALESCE(held_from'))
    // Blocking, not SKIP LOCKED: a job another transaction is moving must be waited for, or the
    // job could end up ahead of a time that then changes.
    expect(read).toMatch(/FOR UPDATE$/)
    expect(read).not.toMatch(/SKIP LOCKED/)
  })

  it('goes ahead of the time another transaction moved a selected job to while the read waited', async () => {
    const a = await backend.enqueue({ name: 'run-task', input: { taskId: 1 }, delaySeconds: 100 })
    const b = await backend.enqueue({ name: 'run-task', input: { taskId: 2 }, delaySeconds: 50 })
    const earlier = new Date(Date.now() + 10_000)
    let moved = false
    // The blocking read waits for the other transaction's move, then sees the committed time.
    const racing: PoolLike = {
      query: (async (sql: string, params?: unknown[]) => {
        if (!moved && sql.includes('SELECT COALESCE(held_from')) {
          moved = true
          await backend.reschedule(pool, b.jobId, { availableAt: earlier })
        }
        return pool.query(sql, params)
      }) as PoolLike['query'],
    }
    expect(
      await backend.reschedule(racing, a.jobId, {
        ahead: { name: 'run-task', where: { taskId: [2] } },
      }),
    ).toBe(true)
    expect(await availableAt(a.jobId)).toBe(earlier.getTime() - 1000)
  })

  it('rejects reschedule with neither or both of availableAt and ahead', async () => {
    const a = await backend.enqueue({ name: 'run-task', input: {} })
    await expect(backend.reschedule(pool, a.jobId, {})).rejects.toThrow(/exactly one/)
  })

  it('a stale nack cannot overwrite a deferred time after the lease expired', async () => {
    const a = await backend.enqueue({ name: 'run-task', input: { taskId: 1 }, maxAttempts: 3 })
    const [lease] = await backend.dequeue({ lockSeconds: 1 })
    await pool.query("UPDATE theokit_jobs SET locked_until = NOW() - INTERVAL '1 second'")
    const until = new Date(Date.now() + 3_600_000)
    expect(await backend.defer(pool, { name: 'run-task', until })).toEqual([a.jobId])
    await backend.nack(a.jobId, { error: 'late', leaseToken: lease.leaseToken }).catch(() => {})
    expect(await availableAt(a.jobId)).toBe(until.getTime())
  })

  it('a stale ack cannot delete a job rescheduled after the lease expired', async () => {
    const a = await backend.enqueue({ name: 'run-task', input: { taskId: 1 } })
    const [lease] = await backend.dequeue({ lockSeconds: 1 })
    await pool.query("UPDATE theokit_jobs SET locked_until = NOW() - INTERVAL '1 second'")
    const moved = await backend.reschedule(pool, a.jobId, {
      availableAt: new Date(Date.now() + 60_000),
    })
    expect(moved).toBe(true)
    await backend.ack(a.jobId, { leaseToken: lease.leaseToken }).catch(() => {})
    expect(await availableAt(a.jobId)).toBeGreaterThan(Date.now())
  })
})

describe('PostgresJobBackend migrate on an older table', () => {
  const FAR = new Date('2999-01-01T00:00:00Z')
  it('migrate() adds held_from to a table made by an older version', async () => {
    const own = newDb({ noAstCoverageCheck: true } as never)
    const ownPool = new (own.adapters.createPg() as { Pool: new () => PoolLike }).Pool()
    const old = new PostgresJobBackend({ pool: ownPool, tableName: 'theokit_jobs_old' })
    await ownPool.query(`CREATE TABLE theokit_jobs_old (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, input JSONB NOT NULL,
      attempts INT NOT NULL DEFAULT 0, max_attempts INT NOT NULL DEFAULT 1,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), locked_until TIMESTAMPTZ,
      traceparent TEXT, idempotency_key TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
    await old.migrate()
    const a = await old.enqueue({ name: 'run-task', input: { taskId: 1 } })
    expect((await old.defer(ownPool, { name: 'run-task', until: FAR })).length).toBe(1)
    expect((await old.restore(ownPool, { name: 'run-task' })).length).toBe(1)
    expect(a.jobId).toBeTruthy()
  })
})

describe('PostgresJobBackend missing pg (T3.1)', () => {
  it('throws actionable error when pool is undefined', () => {
    expect(() => new PostgresJobBackend({ pool: undefined as never })).toThrow(/pg/i)
  })
})
