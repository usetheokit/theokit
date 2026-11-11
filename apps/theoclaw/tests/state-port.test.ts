import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ScheduledJob } from '@theokit/agents/tools'
import { StorageManager, type PoolLike } from 'theokit/server/storage'
import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { openPostgresJobStore } from '../src/scheduler/postgres-job-store.js'
import { loadScheduleStore, scheduleFile } from '../src/scheduler/scheduler-wiring.js'
import { cleanScratch, harness } from './support/cli-harness.js'

afterEach(cleanScratch)

const DSN = 'postgres://claw:s3cret-pw@db.example:5432/claw' // trufflehog:ignore -- fake DSN
const job: ScheduledJob = {
  id: 'j1',
  cron: '@daily',
  prompt: 'say hi',
  target: { platform: 'slack', channelId: 'C1' },
  createdAt: 1,
}

function fakeDatabase(): { rows: Map<string, string>; deps: { makePool: () => PoolLike; manager: StorageManager } } {
  const rows = new Map<string, string>()
  const pool: PoolLike = {
    query: (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SELECT'))
        return Promise.resolve({
          rows: [...rows.values()].map((j) => ({ job: JSON.parse(j), id: (JSON.parse(j) as ScheduledJob).id })) as never[],
        })
      if (sql.startsWith('INSERT')) rows.set(params[0] as string, params[1] as string)
      return Promise.resolve({ rows: [] })
    },
  }
  return { rows, deps: { makePool: () => pool, manager: new StorageManager() } }
}

async function instanceWithJob(): Promise<ReturnType<typeof harness>> {
  const h = harness()
  const workspace = join(h.io.homeDir, 'ws')
  mkdirSync(join(workspace, '.theoclaw'), { recursive: true })
  const sessions = join(workspace, '.theoclaw', 'sessions.json')
  writeFileSync(sessions, '{"s1":2}')
  await loadScheduleStore(workspace).put(job)
  ;(h.io as { env: NodeJS.ProcessEnv }).env.THEOCLAW_WORKSPACE = workspace
  return h
}

describe('theoclaw state port', () => {
  it('copies the jobs, keeps the source, and a second run without --force copies nothing', async () => {
    const h = await instanceWithJob()
    const db = fakeDatabase()
    const io = { ...h.io, database: db.deps }
    const workspace = h.io.env.THEOCLAW_WORKSPACE!
    const before = readFileSync(scheduleFile(workspace), 'utf8')

    expect(await runCli(['state', 'port', '--to', DSN], io)).toBe(0)
    expect(h.stdout()).toContain('copied 1 rows of schedules')
    expect(h.stdout()).not.toContain('s3cret-pw')
    expect(readFileSync(scheduleFile(workspace), 'utf8')).toBe(before)
    expect(readFileSync(join(workspace, '.theoclaw', 'sessions.json'), 'utf8')).toBe('{"s1":2}')

    const opened = await openPostgresJobStore(DSN, db.deps)
    expect(opened.store.list()).toEqual([job])

    db.rows.set('extra', JSON.stringify({ ...job, id: 'extra' }))
    expect(await runCli(['state', 'port', '--to', DSN], io)).toBe(1)
    expect(h.stderr()).toContain('--force')
    expect(h.stderr()).not.toContain('s3cret-pw')
    expect(db.rows.size).toBe(2)
    expect(await runCli(['state', 'port', '--to', DSN, '--force'], io)).toBe(0)
  })

  it('refuses a target that is not a postgres URL', async () => {
    const h = await instanceWithJob()
    expect(await runCli(['state', 'port', '--to', 'sqlite'], h.io)).toBe(1)
    expect(h.stderr()).toContain('postgres')
  })
})
