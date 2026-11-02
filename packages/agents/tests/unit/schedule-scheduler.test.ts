import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Cron } from '@theokit/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  createJobStore,
  type JobStore,
  type ScheduledJob,
  type ScheduleTarget,
} from '../../src/schedule/job-store.js'
import { PREVIOUS_OUTPUT_LIMIT, SILENT } from '../../src/schedule/scheduled-prompt.js'
import {
  createScheduler,
  type RunPort,
  type RunResult,
  type Scheduler,
} from '../../src/schedule/scheduler.js'

let dir: string
let store: JobStore
let scheduler: Scheduler | undefined
let sends: { target: ScheduleTarget; text: string }[]
let lines: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'schedule-scheduler-'))
  store = await createJobStore(join(dir, 'schedules.json'))
  sends = []
  lines = []
})

afterEach(async () => {
  await scheduler?.stop()
  scheduler = undefined
  await rm(dir, { recursive: true, force: true })
})

function job(id: string, extra: Partial<ScheduledJob> = {}): ScheduledJob {
  return {
    id,
    name: `name ${id}`,
    cron: '0 0 1 1 *',
    prompt: `task ${id}`,
    target: { platform: 'telegram', channelId: '42' },
    createdAt: 1,
    ...extra,
  }
}

function make(run: RunPort): Scheduler {
  scheduler = createScheduler({
    store,
    run,
    deliver: (target, text) => {
      sends.push({ target, text })
      return Promise.resolve({ ok: true })
    },
    write: (line) => lines.push(line),
  })
  return scheduler
}

function answering(...texts: string[]): { run: RunPort; prompts: string[] } {
  const prompts: string[] = []
  const run: RunPort = (prompt) => {
    prompts.push(prompt)
    return Promise.resolve({ ok: true, text: texts[prompts.length - 1] ?? '' })
  }
  return { run, prompts }
}

function held(): {
  run: RunPort
  release: (result: RunResult) => void
  signals: AbortSignal[]
  calls: () => number
} {
  const pending: { resolve?: (result: RunResult) => void } = {}
  const signals: AbortSignal[] = []
  const run: RunPort = (_prompt, signal) => {
    signals.push(signal)
    return new Promise<RunResult>((resolve, reject) => {
      pending.resolve = resolve
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    })
  }
  return {
    run,
    release: (result) => pending.resolve?.(result),
    signals,
    calls: () => signals.length,
  }
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`never happened: ${what}`)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('createScheduler', () => {
  it('registers each stored job with the SDK Cron as a workflow', async () => {
    await store.put(job('a', { cron: '*/5 * * * *' }))
    const s = make(answering().run)
    await s.start()
    const { items } = await Cron.list({ runtime: 'local' })
    const mine = items.filter((item) => item.name === 'a')
    expect(mine).toHaveLength(1)
    expect(mine[0]?.cron).toBe('*/5 * * * *')
    expect(mine[0]?.workflow).toBeDefined()
    await s.stop()
    expect(
      (await Cron.list({ runtime: 'local' })).items.filter((item) => item.name === 'a'),
    ).toEqual([])
  })

  it('puts the previous output into the next prompt', async () => {
    await store.put(job('a'))
    const { run, prompts } = answering('first answer', 'second answer')
    const s = make(run)
    expect(await s.fire('a')).toBe('delivered')
    expect(await s.fire('a')).toBe('delivered')
    expect(prompts[0]).not.toContain('Previous output')
    expect(prompts[1]).toContain('Previous output:\nfirst answer')
    expect(prompts[1]).toContain('Task:\ntask a')
    expect(prompts[1]).toContain('Do not create, change or cancel any scheduled job')
    expect(store.get('a')?.previousOutput).toBe('second answer')
  })

  it('carries only the last 4000 characters of the previous output', async () => {
    const previous = `${'x'.repeat(5000)}END`
    await store.put(job('a', { previousOutput: previous }))
    const { run, prompts } = answering('ok')
    make(run)
    await scheduler?.fire('a')
    const carried = prompts[0]?.split('Previous output:\n')[1]?.split('\n\nTask:')[0] ?? ''
    expect(carried).toHaveLength(PREVIOUS_OUTPUT_LIMIT)
    expect(carried.endsWith('END')).toBe(true)
  })

  it('sends nothing when the answer is SILENT', async () => {
    await store.put(job('a', { previousOutput: 'hello' }))
    const s = make(answering(`  ${SILENT}\n`).run)
    expect(await s.fire('a')).toBe('suppressed')
    expect(sends).toEqual([])
    expect(store.get('a')?.previousOutput).toBe(`  ${SILENT}\n`)
  })

  it('removes SILENT from an answer that holds other text', async () => {
    await store.put(job('a'))
    const s = make(answering(`${SILENT} The report is ready.`).run)
    expect(await s.fire('a')).toBe('delivered')
    expect(sends).toEqual([
      { target: { platform: 'telegram', channelId: '42' }, text: 'The report is ready.' },
    ])
  })

  it('delivers a failure line and keeps the previous output when the run throws', async () => {
    await store.put(job('a', { previousOutput: 'kept' }))
    const s = make(() => Promise.reject(new Error('model down')))
    expect(await s.fire('a')).toBe('failed')
    expect(sends.map((send) => send.text)).toEqual(['Scheduled job name a failed: model down'])
    expect(store.get('a')?.previousOutput).toBe('kept')
  })

  it('delivers a failure line when the run reports an error', async () => {
    await store.put(job('a'))
    const s = make(() => Promise.resolve({ ok: false, error: 'budget exceeded' }))
    expect(await s.fire('a')).toBe('failed')
    expect(sends.map((send) => send.text)).toEqual(['Scheduled job name a failed: budget exceeded'])
    expect(store.get('a')?.previousOutput).toBeUndefined()
  })

  it("skips a fire while the job's previous fire runs", async () => {
    await store.put(job('a'))
    const gate = held()
    const s = make(gate.run)
    const first = s.fire('a')
    const second = s.fire('a')
    expect(await second).toBe('skipped')
    await until(() => gate.calls() === 1, 'the first run started')
    gate.release({ ok: true, text: 'done' })
    expect(await first).toBe('delivered')
    expect(gate.calls()).toBe(1)
    expect(s.skipped('a')).toBe(1)
  })

  it('refuses a cron the SDK rejects and stores nothing', async () => {
    const s = make(answering().run)
    await expect(s.add(job('a', { cron: 'not a cron' }))).rejects.toThrow(/cron/i)
    expect(store.list()).toEqual([])
    expect(
      (await Cron.list({ runtime: 'local' })).items.filter((item) => item.name === 'a'),
    ).toEqual([])
  })

  it('adds a job the store keeps and reports its next run', async () => {
    const s = make(answering().run)
    const added = await s.add(job('a'))
    expect(typeof added.nextRunAt).toBe('number')
    expect(store.get('a')?.prompt).toBe('task a')
    expect(s.list().map((entry) => entry.id)).toEqual(['a'])
  })

  it('calls no run when a transient prompt is blank', async () => {
    const { run, prompts } = answering('beat')
    const s = make(run)
    let text: string | undefined = '   '
    await s.add(job('beat'), { durable: false, prompt: () => Promise.resolve(text) })
    expect(await s.fire('beat')).toBe('empty')
    text = undefined
    expect(await s.fire('beat')).toBe('empty')
    expect(prompts).toEqual([])
    text = 'say beat'
    expect(await s.fire('beat')).toBe('delivered')
    expect(prompts[0]).toContain('Task:\nsay beat')
    expect(store.list()).toEqual([])
    expect(s.list()).toEqual([])
  })

  it('does not bring back a job cancelled during its fire (EC-1)', async () => {
    await store.put(job('a'))
    const gate = held()
    const s = make(gate.run)
    const fire = s.fire('a')
    await until(() => gate.calls() === 1, 'the run started')
    expect(await s.cancel('a')).toBe(true)
    gate.release({ ok: true, text: 'late answer' })
    expect(await fire).toBe('cancelled')
    expect(store.get('a')).toBeUndefined()
    expect(sends).toEqual([])
  })

  it('stop aborts an in-flight run and delivers nothing (EC-2)', async () => {
    await store.put(job('a'))
    const gate = held()
    const s = make(gate.run)
    const fire = s.fire('a')
    await until(() => gate.calls() === 1, 'the run started')
    await s.stop()
    expect(gate.signals[0]?.aborted).toBe(true)
    expect(await fire).toBe('cancelled')
    expect(sends).toEqual([])
  })

  it('sends nothing for a blank answer (EC-4)', async () => {
    await store.put(job('a'))
    const s = make(answering('  \n ').run)
    expect(await s.fire('a')).toBe('suppressed')
    expect(sends).toEqual([])
    expect(store.get('a')?.previousOutput).toBe('  \n ')
  })

  it('prints one line when a delivery is refused and keeps the output', async () => {
    await store.put(job('a'))
    scheduler = createScheduler({
      store,
      run: () => Promise.resolve({ ok: true, text: 'hello' }),
      deliver: () => Promise.resolve({ ok: false, error: { code: 'no_adapter' } }),
      write: (line) => lines.push(line),
    })
    expect(await scheduler.fire('a')).toBe('undelivered')
    expect(lines).toEqual(['scheduler: job name a: telegram: no_adapter'])
    expect(store.get('a')?.previousOutput).toBe('hello')
  })
})
