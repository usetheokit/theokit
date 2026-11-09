import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

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
    const store = createJobStore(file)
    expect(store.list()).toEqual([])
  })

  it('keeps the file parseable and mode 0600 over 100 saves of 50 jobs', async () => {
    const store = createJobStore(file)
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
    const reopened = createJobStore(file)
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
    const refusal = () => createJobStore(file)
    expect(refusal).toThrow(ScheduleStoreError)
    expect(refusal).toThrow(file)
    expect(refusal).toThrow('job 0')
  })

  it('refuses a file that is not JSON naming the file', async () => {
    await writeRaw('{ not json')
    const refusal = () => createJobStore(file)
    expect(refusal).toThrow(ScheduleStoreError)
    expect(refusal).toThrow(file)
  })

  it('keeps both jobs when two puts start together', async () => {
    const store = createJobStore(file)
    await Promise.all([store.put(job('a')), store.put(job('b'))])
    const reopened = createJobStore(file)
    expect(
      reopened
        .list()
        .map((entry) => entry.id)
        .sort((x, y) => x.localeCompare(y)),
    ).toEqual(['a', 'b'])
  })

  it('round-trips an output with quotes, newlines and emoji (EC-3)', async () => {
    const store = createJobStore(file)
    await store.put(job('a'))
    const text = 'He said "hi"\nthen left \u{1F44B} \\ done'
    await store.setPreviousOutput('a', text)
    const reopened = createJobStore(file)
    expect(reopened.get('a')?.previousOutput).toBe(text)
  })

  it('refuses an unknown store version naming the file (EC-6)', async () => {
    await writeRaw(JSON.stringify({ version: 2, jobs: [] }))
    const refusal = () => createJobStore(file)
    expect(refusal).toThrow(ScheduleStoreError)
    expect(refusal).toThrow(file)
    expect(refusal).toThrow('version')
  })

  it('ignores a previous output for a job no longer stored (EC-1)', async () => {
    const store = createJobStore(file)
    await store.put(job('a'))
    expect(await store.remove('a')).toBe(true)
    expect(await store.setPreviousOutput('a', 'late')).toBe(false)
    expect(store.list()).toEqual([])
    const reopened = createJobStore(file)
    expect(reopened.get('a')).toBeUndefined()
  })

  it('reports false when removing an id it does not hold', async () => {
    const store = createJobStore(file)
    expect(await store.remove('missing')).toBe(false)
  })
  it('creates an absent store directory with mode 0700', async () => {
    const store = createJobStore(file)
    await store.put(job('a'))
    expect((await stat(dirname(file))).mode & 0o777).toBe(0o700)
  })

  /** Make every save fail (the directory refuses the temporary file) while `act` runs. */
  async function withSavesRefused(act: () => Promise<void>): Promise<void> {
    await chmod(dirname(file), 0o500)
    try {
      await act()
    } finally {
      await chmod(dirname(file), 0o700)
    }
  }

  it('leaves the jobs unchanged when a put fails to save (#82)', async () => {
    const store = createJobStore(file)
    await store.put(job('a'))
    await withSavesRefused(async () => {
      await expect(store.put(job('refused'))).rejects.toThrow()
    })
    expect(store.list().map((held) => held.id)).toEqual(['a'])
    await store.put(job('b'))
    expect(createJobStore(file).get('refused')).toBeUndefined()
  })

  it('keeps a job whose remove fails to save (#82)', async () => {
    const store = createJobStore(file)
    await store.put(job('a'))
    await withSavesRefused(async () => {
      await expect(store.remove('a')).rejects.toThrow()
    })
    expect(store.get('a')).toBeDefined()
  })

  it('keeps the previous output whose save fails (#82)', async () => {
    const store = createJobStore(file)
    await store.put(job('a', { previousOutput: 'before' }))
    await withSavesRefused(async () => {
      await expect(store.setPreviousOutput('a', 'after')).rejects.toThrow()
    })
    expect(store.get('a')?.previousOutput).toBe('before')
  })
})
