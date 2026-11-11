import { getStorageManager, type PoolLike } from 'theokit/server/storage'
import { beforeEach, describe, expect, it } from 'vitest'

import { openPostgresScheduleStore, readDatabaseDsn } from '../src/scheduler/postgres-job-store.js'

/** A pool that understands the five statements the store sends, over a Map: the "database". */
function fakeDatabase() {
  const rows = new Map<string, { job: unknown; created_at: number }>()
  const statements: string[] = []
  const pool = (): PoolLike => ({
    query: ((sql: string, params: unknown[] = []) => {
      statements.push(sql.trim().split(/\s+/)[0] ?? '')
      if (sql.startsWith('INSERT')) rows.set(params[0] as string, { job: JSON.parse(params[1] as string), created_at: params[2] as number })
      if (sql.startsWith('DELETE')) rows.delete(params[0] as string)
      if (sql.startsWith('SELECT')) return Promise.resolve({ rows: [...rows.values()].map((r) => ({ job: r.job })) })
      return Promise.resolve({ rows: [] })
    }) as PoolLike['query'],
    end: () => Promise.resolve(),
  })
  return { rows, statements, pool }
}

const reset = (): void => {
  ;(getStorageManager() as unknown as { __resetForTests(): void }).__resetForTests()
}

const job = { id: 'j1', cron: '@hourly', prompt: 'ping', target: { platform: 'slack', channelId: 'C1' }, createdAt: 5 }

beforeEach(() => {
  reset()
})

describe('THEOCLAW_DATABASE (OC-121)', () => {
  it('selects files unless a postgres DSN is given, and refuses anything else', () => {
    expect(readDatabaseDsn({})).toBeUndefined()
    expect(readDatabaseDsn({ THEOCLAW_DATABASE: 'sqlite' })).toBeUndefined()
    expect(readDatabaseDsn({ THEOCLAW_DATABASE: 'postgres://u@h/db' })).toBe('postgres://u@h/db')
    expect(() => readDatabaseDsn({ THEOCLAW_DATABASE: 'mysql://x' })).toThrow(/postgres/)
  })

  it('keeps a job as a row and finds it again after a restart', async () => {
    const db = fakeDatabase()
    const first = await openPostgresScheduleStore('postgres://u@h/db', db.pool)
    await first.store.put(job)
    expect(db.rows.get('j1')?.job).toEqual(job)
    await first.store.setPreviousOutput('j1', 'pong')
    await first.close()

    reset()
    const second = await openPostgresScheduleStore('postgres://u@h/db', db.pool)
    expect(second.store.get('j1')).toEqual({ ...job, previousOutput: 'pong' })
    expect(await second.store.remove('j1')).toBe(true)
    expect(db.rows.size).toBe(0)
    expect(await second.store.remove('j1')).toBe(false)
    await second.close()
  })

  it('refuses the start, with no file fallback, when PostgreSQL fails', async () => {
    const failing = (): PoolLike => ({ query: () => Promise.reject(new Error('ECONNREFUSED')) })
    await expect(openPostgresScheduleStore('postgres://u@h/db', failing)).rejects.toThrow(/THEOCLAW_DATABASE.*ECONNREFUSED/)
  })
})
