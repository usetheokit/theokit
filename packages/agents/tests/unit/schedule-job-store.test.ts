import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createJobStore,
  ScheduleStoreError,
  type ScheduledJob,
} from '../../src/schedule/job-store.js'

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'schedule-store-'))
  file = join(dir, 'state', 'schedules.json')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function job(id: string, extra: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id,
    cron: '* * * * *',
    prompt: `prompt ${id}`,
    target: { platform: 'telegram', channelId: '42' },
    createdAt: 1,
    ...extra,
  }
}

async function writeRaw(text: string): Promise<void> {
  const flat = join(dir, 'schedules.json')
  await writeFile(flat, text)
  file = flat
}

describe('createJobStore', () => {
  it('reads an absent file as an empty store', async () => {
    const store = await createJobStore(file)
    expect(store.list()).toEqual([])
  })

  it('keeps the file parseable and mode 0600 over 100 saves of 50 jobs', async () => {
    const store = await createJobStore(file)
    for (let i = 0; i < 100; i++) {
      await store.put(job(`job-${String(i % 50)}`, { previousOutput: `run ${String(i)}` }))
      const parsed = JSON.parse(await readFile(file, 'utf8')) as {
        version: number
        jobs: unknown[]
      }
      expect(parsed.version).toBe(1)
      expect((await stat(file)).mode & 0o777).toBe(0o600)
    }
    expect(store.list()).toHaveLength(50)
    const reopened = await createJobStore(file)
    expect(reopened.list()).toHaveLength(50)
    expect(reopened.get('job-49')?.previousOutput).toBe('run 99')
  })

  it('refuses a job with no target naming the file', async () => {
    await writeRaw(
      JSON.stringify({
        version: 1,
        jobs: [{ id: 'a', cron: '* * * * *', prompt: 'p', createdAt: 1 }],
      }),
    )
    const refusal = createJobStore(file)
    await expect(refusal).rejects.toBeInstanceOf(ScheduleStoreError)
    await expect(refusal).rejects.toThrow(file)
    await expect(refusal).rejects.toThrow('job 0')
  })

  it('refuses a file that is not JSON naming the file', async () => {
    await writeRaw('{ not json')
    const refusal = createJobStore(file)
    await expect(refusal).rejects.toBeInstanceOf(ScheduleStoreError)
    await expect(refusal).rejects.toThrow(file)
  })

  it('keeps both jobs when two puts start together', async () => {
    const store = await createJobStore(file)
    await Promise.all([store.put(job('a')), store.put(job('b'))])
    const reopened = await createJobStore(file)
    expect(
      reopened
        .list()
        .map((entry) => entry.id)
        .sort((x, y) => x.localeCompare(y)),
    ).toEqual(['a', 'b'])
  })

  it('round-trips an output with quotes, newlines and emoji (EC-3)', async () => {
    const store = await createJobStore(file)
    await store.put(job('a'))
    const text = 'He said "hi"\nthen left \u{1F44B} \\ done'
    await store.setPreviousOutput('a', text)
    const reopened = await createJobStore(file)
    expect(reopened.get('a')?.previousOutput).toBe(text)
  })

  it('refuses an unknown store version naming the file (EC-6)', async () => {
    await writeRaw(JSON.stringify({ version: 2, jobs: [] }))
    const refusal = createJobStore(file)
    await expect(refusal).rejects.toBeInstanceOf(ScheduleStoreError)
    await expect(refusal).rejects.toThrow(file)
    await expect(refusal).rejects.toThrow('version')
  })

  it('ignores a previous output for a job no longer stored (EC-1)', async () => {
    const store = await createJobStore(file)
    await store.put(job('a'))
    expect(await store.remove('a')).toBe(true)
    expect(await store.setPreviousOutput('a', 'late')).toBe(false)
    expect(store.list()).toEqual([])
    const reopened = await createJobStore(file)
    expect(reopened.get('a')).toBeUndefined()
  })

  it('reports false when removing an id it does not hold', async () => {
    const store = await createJobStore(file)
    expect(await store.remove('missing')).toBe(false)
  })
})
