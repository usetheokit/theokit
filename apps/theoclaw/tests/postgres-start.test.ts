import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { StorageManager, type PoolLike } from 'theokit/server/storage'
import { afterEach, describe, expect, it } from 'vitest'

import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { scheduleFile } from '../src/scheduler/scheduler-wiring.js'
import { notEnforced, runControlTurn, startForTools, stop, tempCwd } from './tool-start-fixtures.js'
import type { ToolStart } from './tool-start-fixtures.js'

const DSN = 'postgres://claw:s3cret-pw@db.example:5432/claw' // trufflehog:ignore -- fake DSN, db.example never resolves
const cleanups: (() => void)[] = []
const started: ToolStart[] = []
afterEach(async () => {
  for (const s of started.splice(0)) await stop(s)
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A table in memory standing in for PostgreSQL; it outlives each start. */
function fakeDatabase(): { rows: Map<string, string>; makePool: () => PoolLike } {
  const rows = new Map<string, string>()
  const pool: PoolLike = {
    query: (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SELECT')) {
        return Promise.resolve({
          rows: [...rows.values()].map((job) => ({ job: JSON.parse(job) })) as never[],
        })
      }
      if (sql.startsWith('INSERT')) rows.set(params[0] as string, params[1] as string)
      if (sql.startsWith('DELETE')) rows.delete(params[0] as string)
      return Promise.resolve({ rows: [] })
    },
  }
  return { rows, makePool: () => pool }
}

async function start(
  env: Record<string, string>,
  cwd: string,
  extra: Parameters<typeof startForTools>[3],
): Promise<ToolStart> {
  const result = await startForTools(env, cwd, { detect: notEnforced }, extra)
  started.push(result)
  return result
}

describe('startTheoClaw with THEOCLAW_DATABASE', () => {
  it('a job a turn creates is a Postgres row and is listed again after a restart', async () => {
    const db = fakeDatabase()
    const cwd = tempCwd(cleanups)
    const env = { THEOCLAW_DATABASE: DSN }

    const first = await start(env, cwd, {
      database: { makePool: db.makePool, manager: new StorageManager() },
    })
    expect(first.error).toBeUndefined()
    const tools = (await runControlTurn(first)).tools
    const schedule = tools.find((tool) => tool.name === 'schedule_job')!
    const answer = JSON.parse(
      String(
        await schedule.handler({
          cron: '@daily',
          prompt: 'say hi',
          platform: 'telegram',
          channelId: '42',
        }),
      ),
    ) as { ok: boolean; id: string }
    expect(answer.ok).toBe(true)
    expect(db.rows.size).toBe(1)
    expect(existsSync(scheduleFile(cwd))).toBe(false)
    await stop(first)
    started.splice(started.indexOf(first), 1)

    const second = await start(env, cwd, {
      database: { makePool: db.makePool, manager: new StorageManager() },
    })
    expect(second.error).toBeUndefined()
    const list = (await runControlTurn(second)).tools.find(
      (tool) => tool.name === 'list_scheduled_jobs',
    )!
    expect(String(await list.handler({}))).toContain(answer.id)
  })

  it('refuses the start, without falling back to the file, when the database is down', async () => {
    const cwd = tempCwd(cleanups)
    const down: PoolLike = { query: () => Promise.reject(new Error('ECONNREFUSED')) }
    const result = await start({ THEOCLAW_DATABASE: DSN }, cwd, {
      database: { makePool: () => down, manager: new StorageManager() },
    })
    expect(result.error?.message).toMatch(/unreachable.*ECONNREFUSED/)
    expect(existsSync(scheduleFile(cwd))).toBe(false)
  })

  it('names THEOCLAW_DATABASE when the value is neither a file engine nor a postgres URL', async () => {
    const result = await start({ THEOCLAW_DATABASE: 'mysql://x' }, tempCwd(cleanups), {})
    expect(result.error).toBeInstanceOf(TheoClawConfigError)
    expect((result.error as TheoClawConfigError).variable).toBe('THEOCLAW_DATABASE')
    expect(result.builds()).toBe(0)
  })
})
