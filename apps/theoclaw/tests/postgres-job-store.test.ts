import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ScheduledJob } from '@theokit/agents/tools'
import { StorageManager, type PoolLike } from 'theokit/server/storage'

const job: ScheduledJob = {
  id: 'j1',
  cron: '@daily',
  prompt: 'say hi',
  target: { platform: 'slack', channelId: 'C1' },
  createdAt: 1,
}

/** A table-in-memory standing in for PostgreSQL; it outlives the "restart" below. */
const table = new Map<string, string>()
const fakePool = (config: Record<string, unknown>): PoolLike => {
  expect(config).toMatchObject({
    host: 'db.example',
    port: 5433,
    user: 'u',
    password: 'p@ss',
    database: 'claw',
  })
  return {
    query: (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SELECT'))
        return Promise.resolve({
          rows: [...table.values()].map((j) => ({ job: JSON.parse(j) })) as never[],
        })
      if (sql.startsWith('INSERT')) table.set(params[0] as string, params[1] as string)
      if (sql.startsWith('DELETE')) table.delete(params[0] as string)
      return Promise.resolve({ rows: [] })
    },
  }
}

describe('readDatabaseSetting', () => {
  it('keeps the files unless a postgres URL is given', async () => {
    const { readDatabaseSetting } = await import('../src/scheduler/postgres-job-store.js')
    expect(readDatabaseSetting({})).toEqual({ engine: 'files' })
    expect(readDatabaseSetting({ THEOCLAW_DATABASE: 'sqlite' })).toEqual({ engine: 'files' })
    expect(readDatabaseSetting({ THEOCLAW_DATABASE: 'postgres://u@h/d' })).toEqual({
      engine: 'postgres',
      dsn: 'postgres://u@h/d',
    })
    expect(() => readDatabaseSetting({ THEOCLAW_DATABASE: 'mysql://x' })).toThrow(
      /THEOCLAW_DATABASE/,
    )
  })
})

describe('postgres job store', () => {
  beforeEach(() => {
    table.clear()
    vi.resetModules()
  })
  const dsn = 'postgres://u:p%40ss@db.example:5433/claw' // trufflehog:ignore -- fake DSN, db.example never resolves

  it('keeps a job as a row that survives a restart', async () => {
    const first = await (
      await import('../src/scheduler/postgres-job-store.js')
    ).openPostgresJobStore(dsn, { makePool: fakePool, manager: new StorageManager() })
    await first.store.put(job)
    expect(table.size).toBe(1)
    await first.store.setPreviousOutput('j1', 'hello')

    vi.resetModules() // a new process: a new storage manager, the same database
    const second = await (
      await import('../src/scheduler/postgres-job-store.js')
    ).openPostgresJobStore(dsn, { makePool: fakePool, manager: new StorageManager() })
    expect(second.store.get('j1')).toMatchObject({ prompt: 'say hi', previousOutput: 'hello' })
    expect(await second.store.remove('j1')).toBe(true)
    expect(table.size).toBe(0)
  })

  it('refuses to start, without falling back to the file, when the database fails', async () => {
    const { openPostgresJobStore } = await import('../src/scheduler/postgres-job-store.js')
    await expect(
      openPostgresJobStore(dsn, {
        makePool: () => ({ query: () => Promise.reject(new Error('ECONNREFUSED')) }),
        manager: new StorageManager(),
      }),
    ).rejects.toThrow(/unreachable.*ECONNREFUSED/)
  })
})
