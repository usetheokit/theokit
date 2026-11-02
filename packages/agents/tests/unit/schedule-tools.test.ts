import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { CustomTool } from '@theokit/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createJobStore, type JobStore } from '../../src/schedule/job-store.js'
import { createScheduleTools } from '../../src/schedule/schedule-tools.js'
import { createScheduler, type Scheduler } from '../../src/schedule/scheduler.js'

let dir: string
let store: JobStore
let scheduler: Scheduler
let tools: CustomTool[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'schedule-tools-'))
  store = createJobStore(join(dir, 'schedules.json'))
  scheduler = createScheduler({
    store,
    run: () => Promise.resolve({ ok: true, text: 'ok' }),
    deliver: () => Promise.resolve({ ok: true }),
    write: () => undefined,
  })
  tools = createScheduleTools({ scheduler, platforms: ['telegram', 'slack'], maxJobs: 3 })
})

afterEach(async () => {
  await scheduler.stop()
  await rm(dir, { recursive: true, force: true })
})

function tool(name: string): CustomTool {
  const found = tools.find((entry) => entry.name === name)
  if (found === undefined) throw new Error(`no tool ${name}`)
  return found
}

async function call(
  name: string,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return JSON.parse(String(await tool(name).handler(input))) as Record<string, unknown>
}

const valid = {
  cron: '0 9 * * *',
  prompt: 'summarize the news',
  platform: 'telegram',
  channelId: '42',
}

describe('createScheduleTools', () => {
  it('exposes the three schedule tools', () => {
    expect(tools.map((entry) => entry.name)).toEqual([
      'schedule_job',
      'list_scheduled_jobs',
      'cancel_scheduled_job',
    ])
  })

  it('schedules a job the store keeps', async () => {
    const answer = await call('schedule_job', { ...valid, name: 'news', timezone: 'Europe/Lisbon' })
    expect(answer.ok).toBe(true)
    expect(answer.id).toMatch(/^job-[0-9a-f]{8}$/)
    expect(typeof answer.nextRunAt).toBe('number')
    const kept = store.get(String(answer.id))
    expect(kept).toMatchObject({
      name: 'news',
      cron: '0 9 * * *',
      timezone: 'Europe/Lisbon',
      prompt: 'summarize the news',
      target: { platform: 'telegram', channelId: '42' },
    })
    const listed = await call('list_scheduled_jobs', {})
    expect(listed.jobs).toEqual([
      {
        id: answer.id,
        name: 'news',
        cron: '0 9 * * *',
        target: { platform: 'telegram', channelId: '42' },
      },
    ])
  })

  it('refuses a platform outside the configured ones', async () => {
    const answer = await call('schedule_job', { ...valid, platform: 'discord' })
    expect(answer.ok).toBe(false)
    expect(String(answer.error)).toContain('discord')
    expect(store.list()).toEqual([])
  })

  it('refuses a cron the SDK rejects', async () => {
    const answer = await call('schedule_job', { ...valid, cron: '61 * * * *' })
    expect(answer.ok).toBe(false)
    expect(String(answer.error)).toMatch(/cron/i)
    expect(store.list()).toEqual([])
  })

  it('refuses the 51st job', async () => {
    for (let i = 0; i < 3; i++) expect((await call('schedule_job', valid)).ok).toBe(true)
    const answer = await call('schedule_job', valid)
    expect(answer.ok).toBe(false)
    expect(String(answer.error)).toContain('3')
    expect(store.list()).toHaveLength(3)
  })

  it('refuses a timezone the SDK rejects (EC-5)', async () => {
    const answer = await call('schedule_job', { ...valid, timezone: 'Mars/Olympus' })
    expect(answer.ok).toBe(false)
    expect(String(answer.error)).toMatch(/timezone/i)
    expect(store.list()).toEqual([])
  })

  it('refuses an input missing a field and stores nothing', async () => {
    await expect(
      tool('schedule_job').handler({ cron: '0 9 * * *', platform: 'telegram', channelId: '42' }),
    ).rejects.toThrow(/prompt/)
    expect(store.list()).toEqual([])
  })

  it('cancels a job by id', async () => {
    const created = await call('schedule_job', valid)
    expect(await call('cancel_scheduled_job', { id: created.id })).toEqual({ ok: true })
    expect(store.list()).toEqual([])
    expect(await call('cancel_scheduled_job', { id: created.id })).toEqual({
      ok: false,
      error: 'no such job',
    })
  })
})
