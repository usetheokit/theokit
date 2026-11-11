import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ScheduledJob } from '@theokit/agents/tools'
import { StorageManager, type PoolLike } from 'theokit/server/storage'
import { describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { UsageError } from '../src/cli-args.js'
import { openPostgresJobStore } from '../src/scheduler/postgres-job-store.js'
import { statePortCommand } from '../src/state/port-command.js'
import { harness, scratchDir } from './support/cli-harness.js'

const DSN = 'postgres://claw:s3cret-pw@db.example:5432/claw' // trufflehog:ignore -- fake DSN, db.example never resolves
const job: ScheduledJob = {
  id: 'j1',
  cron: '@daily',
  prompt: 'say hi',
  target: { platform: 'slack', channelId: 'C1' },
  createdAt: 1,
}

function fakeDatabase(): { rows: Map<string, string>; makePool: () => PoolLike } {
  const rows = new Map<string, string>()
  const pool: PoolLike = {
    query: (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SELECT')) {
        return Promise.resolve({ rows: [...rows.values()].map((j) => ({ job: JSON.parse(j) })) as never[] })
      }
      if (sql.startsWith('INSERT')) rows.set(params[0] as string, params[1] as string)
      if (sql.startsWith('DELETE')) rows.delete(params[0] as string)
      return Promise.resolve({ rows: [] })
    },
  }
  return { rows, makePool: () => pool }
}

function workspaceWithJob(): { workspace: string; file: string } {
  const workspace = scratchDir()
  mkdirSync(join(workspace, '.theoclaw'), { recursive: true })
  const file = join(workspace, '.theoclaw', 'schedules.json')
  writeFileSync(file, JSON.stringify({ version: 1, jobs: [job] }))
  return { workspace, file }
}

async function port(args: string[], workspace: string, db: ReturnType<typeof fakeDatabase>) {
  const h = harness()
  const io = { ...h.io, env: { ...h.io.env, THEOCLAW_WORKSPACE: workspace } }
  const code = await statePortCommand(args, io, { makePool: db.makePool, manager: new StorageManager() })
  return { code, out: h.stdout(), err: h.stderr() }
}

describe('theoclaw state port', () => {
  it('copies the jobs, keeps the source, and a second run without --force copies nothing', async () => {
    const { workspace, file } = workspaceWithJob()
    const before = readFileSync(file, 'utf8')
    const db = fakeDatabase()

    const first = await port(['port', '--to', DSN], workspace, db)
    expect(first).toMatchObject({ code: 0, out: 'schedules: 1 rows copied\n' })
    expect(db.rows.size).toBe(1)
    expect(readFileSync(file, 'utf8')).toBe(before)

    const reopened = await openPostgresJobStore(DSN, { makePool: db.makePool, manager: new StorageManager() })
    expect(reopened.store.list().map((j) => j.id)).toEqual(['j1'])

    const second = await port(['port', '--to', DSN], workspace, db)
    expect(second.code).toBe(1)
    expect(second.err).toContain('--force')
    expect(second.err).not.toContain('s3cret-pw')
    expect(second.out).toBe('')

    const forced = await port(['port', '--to', DSN, '--force'], workspace, db)
    expect(forced).toMatchObject({ code: 0, out: 'schedules: 1 rows copied\n' })
  })

  it('refuses a missing or non-postgres target as a usage error', async () => {
    const { workspace } = workspaceWithJob()
    const db = fakeDatabase()
    await expect(port(['port'], workspace, db)).rejects.toBeInstanceOf(UsageError)
    await expect(port(['port', '--to', 'sqlite'], workspace, db)).rejects.toBeInstanceOf(UsageError)
    await expect(port(['nope'], workspace, db)).rejects.toBeInstanceOf(UsageError)
  })

  it('is reachable as `theoclaw state`', async () => {
    const h = harness()
    expect(await runCli(['state', 'port'], h.io)).toBe(2)
  })
})
