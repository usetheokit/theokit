import { describe, expect, it } from 'vitest'

import {
  createJobStore,
  ScheduleStoreError,
  type ScheduledJob,
} from '../../src/schedule/job-store.js'
import {
  copyJobs,
  createPostgresJobStore,
  JobCopyError,
  type SqlPool,
} from '../../src/schedule/postgres-job-store.js'

function job(id: string): ScheduledJob {
  return {
    id,
    cron: '@daily',
    prompt: 'p',
    target: { platform: 'slack', channelId: 'C1' },
    createdAt: 1,
  }
}

function fakePool(rows: { id: string; job: unknown }[] = []) {
  const calls: { sql: string; params?: readonly unknown[] }[] = []
  const state = { fail: undefined as Error | undefined }
  const pool: SqlPool = {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- mirrors SqlPool
    query: async <R>(sql: string, params?: readonly unknown[]) => {
      calls.push({ sql, params })
      if (state.fail !== undefined && /^(INSERT|DELETE)/.test(sql)) throw state.fail
      return { rows: (sql.startsWith('SELECT') ? rows : []) as R[] }
    },
  }
  return { pool, calls, state }
}

describe('createPostgresJobStore', () => {
  it('loads rows and writes through', async () => {
    const { pool, calls } = fakePool([{ id: 'a', job: job('a') }])
    const store = await createPostgresJobStore(pool)
    expect(store.get('a')).toEqual(job('a'))
    await store.put(job('b'))
    expect(store.list()).toHaveLength(2)
    expect(await store.setPreviousOutput('b', 'out')).toBe(true)
    expect(store.get('b')?.previousOutput).toBe('out')
    expect(await store.setPreviousOutput('zz', 'x')).toBe(false)
    expect(await store.remove('b')).toBe(true)
    expect(calls.some((c) => c.sql.startsWith('CREATE TABLE IF NOT EXISTS'))).toBe(true)
  })

  it('a malformed row is refused with ScheduleStoreError naming the table and job id', async () => {
    const { pool } = fakePool([{ id: 'bad1', job: { id: 'bad1' } }])
    const error = await createPostgresJobStore(pool, { table: 'my_jobs' }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ScheduleStoreError)
    expect((error as Error).message).toContain('my_jobs')
    expect((error as Error).message).toContain('bad1')
  })

  it('an invalid table name is refused', async () => {
    const { pool } = fakePool()
    for (const table of ['Jobs', '1x', 'a;drop', '', 'a'.repeat(64)]) {
      await expect(createPostgresJobStore(pool, { table })).rejects.toBeInstanceOf(
        ScheduleStoreError,
      )
    }
  })

  it('keeps the original error as cause when the database is unreachable', async () => {
    const cause = new Error('ECONNREFUSED')
    const pool: SqlPool = { query: () => Promise.reject(cause) }
    const error = await createPostgresJobStore(pool).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ScheduleStoreError)
    expect((error as Error).cause).toBe(cause)
  })

  it('writes run one after another', async () => {
    const { calls, pool } = fakePool()
    const slow: SqlPool = {
      query: async (sql, params) => {
        if (params?.[0] === 'first') await new Promise((r) => setTimeout(r, 20))
        return pool.query(sql, params)
      },
    }
    const store = await createPostgresJobStore(slow)
    await Promise.all([store.put(job('first')), store.put(job('second'))])
    const ids = calls.filter((c) => c.sql.startsWith('INSERT')).map((c) => c.params?.[0])
    expect(ids).toEqual(['first', 'second'])
  })

  it('a refused write leaves memory unchanged and later writes still run', async () => {
    const { pool, state } = fakePool()
    const store = await createPostgresJobStore(pool)
    state.fail = new Error('disk full')
    await expect(store.put(job('a'))).rejects.toThrow('disk full')
    expect(store.list()).toEqual([])
    state.fail = undefined
    await store.put(job('b'))
    expect(store.list()).toHaveLength(1)
  })
})

describe('copyJobs', () => {
  it('copyJobs refuses a non-empty target without force, and with force copies every job', async () => {
    const dummy = fakePool([{ id: 'x', job: job('x') }])
    const target = await createPostgresJobStore(dummy.pool)
    const source = createJobStore('/nonexistent-dir/none.json')
    const from = { ...source, list: () => [job('a'), job('b')] }
    const error = await copyJobs(from, target, { force: false }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(JobCopyError)
    expect((error as Error).message).toContain('1 job')
    expect(await copyJobs(from, target, { force: true })).toBe(2)
    expect(
      target
        .list()
        .map((j) => j.id)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['a', 'b', 'x'])
    // one statement for the whole copy
    expect(dummy.calls.filter((c) => c.sql.startsWith('INSERT'))).toHaveLength(1)
  })

  it('a failed bulk copy leaves the target unchanged', async () => {
    const { pool, state } = fakePool()
    const target = await createPostgresJobStore(pool)
    state.fail = new Error('boom')
    const from = { ...createJobStore('/nonexistent-dir/none.json'), list: () => [job('a')] }
    await expect(copyJobs(from, target, { force: false })).rejects.toThrow('boom')
    expect(target.list()).toEqual([])
  })
})
