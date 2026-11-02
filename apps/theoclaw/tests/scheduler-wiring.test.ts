import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PlatformName, SendResult } from '@theokit/gateway'
import { createJobStore, type JobStore, ScheduleStoreError } from '@theokit/agents/tools'
import type { AgentOptions } from '@theokit/sdk'
import { Cron } from '@theokit/sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { TurnAgent, TurnRun } from '../src/agent-port.js'
import type { StartedPlatform } from '../src/channels/channel-loop.js'
import type { AgentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { type RunningScheduler, scheduleFile, wireScheduler } from '../src/scheduler/scheduler-wiring.js'
import { fakeBuilders, signedLinePost } from './composition-fixtures.js'
import { FakeAdapter, FakeAgent, waitFor } from './fakes.js'
import { notEnforced, runControlTurn, startForTools, stop, tempCwd } from './tool-start-fixtures.js'

const SCHEDULE_TOOLS = ['schedule_job', 'list_scheduled_jobs', 'cancel_scheduled_job']

/** An agent that answers `answer`, or holds until its signal aborts when `answer` is undefined. */
class AnsweringAgent implements TurnAgent {
  readonly signals: (AbortSignal | undefined)[] = []
  readonly options: unknown[] = []
  constructor(private readonly answer: string | undefined) {}

  send(_text: string, options?: { readonly signal?: AbortSignal }): Promise<TurnRun> {
    const signal = options?.signal
    this.signals.push(signal)
    this.options.push(options)
    const answer = this.answer
    return Promise.resolve({
      // eslint-disable-next-line @typescript-eslint/require-await -- the port's stream is async
      async *stream() {
        yield { type: 'assistant' }
      },
      cancel: () => Promise.resolve(),
      wait: () =>
        answer !== undefined
          ? Promise.resolve({ status: 'finished', result: answer })
          : new Promise((resolve) => {
              signal?.addEventListener('abort', () => resolve({ status: 'cancelled' }), { once: true })
            }),
    })
  }
}

let dir: string
let store: JobStore
let lines: string[]
let started: Map<PlatformName, StartedPlatform>
let running: RunningScheduler | undefined
const cleanups: (() => void)[] = []

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'scheduler-wiring-'))
  store = createJobStore(scheduleFile(dir))
  lines = []
  started = new Map()
})

afterEach(async () => {
  await running?.stop()
  running = undefined
  rmSync(dir, { recursive: true, force: true })
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function connect(adapter: FakeAdapter): void {
  started.set(adapter.platform, { adapter } as unknown as StartedPlatform)
}

async function start(
  agent: TurnAgent,
  built: AgentToolOptions[] = [],
  secrets: readonly string[] = [],
): Promise<RunningScheduler> {
  running = wireScheduler({
    store,
    loop: { started },
    buildRunAgent: (options) => {
      built.push(options)
      return agent
    },
    tools: resolveToolSettings({}, dir, { detect: notEnforced, warn: () => undefined }),
    platforms: ['telegram', 'slack'],
    write: (line) => lines.push(line),
    secrets,
  })
  await running.start()
  return running
}

const job = (platform = 'telegram') => ({
  id: 'job-1',
  name: 'news',
  cron: '0 0 1 1 *',
  prompt: 'say hello',
  target: { platform, channelId: '42' },
  createdAt: 1,
})

describe('wireScheduler', () => {
  it('delivers a fired job through the adapter the loop connected', async () => {
    const telegram = new FakeAdapter('telegram')
    connect(telegram)
    const { scheduler } = await start(new AnsweringAgent('hello there'))
    await scheduler.add(job())
    expect(await scheduler.fire('job-1')).toBe('delivered')
    expect(telegram.sent).toEqual([{ channel: { id: '42', type: 'group' }, text: 'hello there' }])
    expect(lines[0]).toBe('scheduler: 0 jobs, heartbeat off')
  })

  it('sends the run with the untrusted content options, so its tool results reach the model framed (OC-88)', async () => {
    connect(new FakeAdapter('telegram'))
    const agent = new AnsweringAgent('ok')
    const { scheduler } = await start(agent)
    await scheduler.add(job())
    await scheduler.fire('job-1')
    expect(agent.options[0]).toMatchObject({ toolResultGuard: { delimit: true } })
    expect(agent.signals[0]).toBeInstanceOf(AbortSignal)
  })

  it('masks a configured value in the delivered answer (OC-90)', async () => {
    const telegram = new FakeAdapter('telegram')
    connect(telegram)
    const { scheduler } = await start(new AnsweringAgent('the key is sk-live-123, keep it'), [], ['sk-live-123'])
    await scheduler.add(job())
    expect(await scheduler.fire('job-1')).toBe('delivered')
    const sent = telegram.sent.map((message) => message.text).join('\n')
    expect(sent).not.toContain('sk-live-123')
    expect(sent).toContain('the key is')
  })

  it('prints one line when a delivery has no adapter', async () => {
    const { scheduler } = await start(new AnsweringAgent('hello'))
    await scheduler.add(job('slack'))
    expect(await scheduler.fire('job-1')).toBe('undelivered')
    expect(lines).toContain('scheduler: job news: slack: no_adapter')
    expect(store.get('job-1')?.previousOutput).toBe('hello')
  })

  it('builds the run agent with the read-only worker options and no schedule tool', async () => {
    const built: AgentToolOptions[] = []
    const { scheduler } = await start(new AnsweringAgent('ok'), built)
    await scheduler.add(job())
    await scheduler.fire('job-1')
    expect(built).toHaveLength(1)
    const names = built[0]?.tools.map((tool) => tool.name) ?? []
    expect(names).toContain('read_file')
    for (const name of [...SCHEDULE_TOOLS, 'run_code', 'delegate_all']) expect(names).not.toContain(name)
  })

  it('reaches an adapter that connected after the scheduler started', async () => {
    const { scheduler } = await start(new AnsweringAgent('late hello'))
    await scheduler.add(job())
    const telegram = new FakeAdapter('telegram')
    connect(telegram)
    expect(await scheduler.fire('job-1')).toBe('delivered')
    expect(telegram.sent.map((message) => message.text)).toEqual(['late hello'])
  })

  it('reports an adapter that throws as undelivered and keeps the output', async () => {
    connect(new FakeAdapter('telegram', { send: (): Promise<SendResult> => Promise.reject(new Error('socket closed')) }))
    const { scheduler } = await start(new AnsweringAgent('kept'))
    await scheduler.add(job())
    expect(await scheduler.fire('job-1')).toBe('undelivered')
    expect(lines).toContain('scheduler: job news: telegram: adapter_threw')
    expect(store.get('job-1')?.previousOutput).toBe('kept')
  })

  it('aborts an in-flight run on stop and sends nothing after it (EC-2)', async () => {
    const telegram = new FakeAdapter('telegram')
    connect(telegram)
    const agent = new AnsweringAgent(undefined)
    const { scheduler } = await start(agent)
    await scheduler.add(job())
    const fire = scheduler.fire('job-1')
    const deadline = Date.now() + 2000
    while (agent.signals.length === 0) {
      if (Date.now() > deadline) throw new Error('the run never started')
      await new Promise((resolve) => setImmediate(resolve))
    }
    await running?.stop()
    expect(agent.signals[0]?.aborted).toBe(true)
    expect(await fire).toBe('cancelled')
    expect(telegram.sent).toEqual([])
  })
})

describe('startTheoClaw with the scheduler', () => {
  it('gives the schedule tools to control agents', async () => {
    const workspace = tempCwd(cleanups)
    const app = await startForTools({ THEOCLAW_WORKSPACE: workspace }, workspace, { detect: notEnforced })
    try {
      expect(app.error).toBeUndefined()
      const options = await runControlTurn(app)
      const names = options.tools.map((tool) => tool.name)
      for (const name of SCHEDULE_TOOLS) expect(names).toContain(name)
      expect(app.output()).toContain('scheduler: 0 jobs, heartbeat off')
    } finally {
      await stop(app)
    }
  })

  it('opens a chat agent with no schedule tool in a start that has the scheduler', async () => {
    const workspace = tempCwd(cleanups)
    const received: AgentOptions[] = []
    const app = await startForTools({ THEOCLAW_WORKSPACE: workspace }, workspace, { detect: notEnforced }, {
      getOrCreate: (_id, options) => {
        received.push(options)
        return Promise.resolve(Object.assign(new FakeAgent({ frames: [] }), { dispose: () => Promise.resolve() }))
      },
    })
    try {
      expect(app.error).toBeUndefined()
      await app.app?.loop.ready
      expect((await app.app?.router(signedLinePost()))?.status).toBe(200)
      await waitFor(() => received.length === 1, 2000, 'the chat agent to be opened')
      const names = (received[0]?.tools ?? []).map((tool) => tool.name)
      for (const name of SCHEDULE_TOOLS) expect(names).not.toContain(name)
    } finally {
      await stop(app)
    }
  })

  it('aborts an in-flight scheduled run on SIGTERM before any adapter stops', async () => {
    const workspace = tempCwd(cleanups)
    mkdirSync(join(workspace, '.theoclaw'), { recursive: true, mode: 0o700 })
    await createJobStore(scheduleFile(workspace)).put({
      id: 'job-sigterm',
      cron: '0 0 1 1 *',
      prompt: 'hold',
      target: { platform: 'telegram', channelId: '42' },
      createdAt: 1,
    })
    const { adapters, builders } = fakeBuilders()
    const runAgent = new AnsweringAgent(undefined)
    const signals = new EventEmitter()
    let exited: () => void = () => undefined
    const exit = new Promise<void>((resolve) => {
      exited = resolve
    })
    const app = await startForTools({ THEOCLAW_WORKSPACE: workspace }, workspace, { detect: notEnforced }, {
      builders,
      signals,
      exit: () => exited(),
      importFreeAgentFactory: () => runAgent,
    })
    expect(app.error).toBeUndefined()
    const sdkJob = (await Cron.list({ runtime: 'local' })).items.find((item) => item.name === 'job-sigterm')
    if (sdkJob === undefined) throw new Error('the stored job was not registered')
    await Cron.run(sdkJob.id)
    await waitFor(() => runAgent.signals.length === 1, 2000, 'the scheduled run to start')
    const disconnectsAtAbort: number[] = []
    runAgent.signals[0]?.addEventListener(
      'abort',
      () => {
        for (const adapter of adapters.values()) disconnectsAtAbort.push(adapter.disconnects)
      },
      { once: true },
    )
    signals.emit('SIGTERM')
    await exit
    expect(runAgent.signals[0]?.aborted).toBe(true)
    expect(disconnectsAtAbort.length).toBeGreaterThan(0)
    expect(disconnectsAtAbort.every((count) => count === 0)).toBe(true)
    expect([...adapters.values()].flatMap((adapter) => adapter.sent)).toEqual([])
  })

  it('refuses the start on a malformed schedules.json before any channel connects', async () => {
    const workspace = tempCwd(cleanups)
    mkdirSync(join(workspace, '.theoclaw'), { recursive: true })
    writeFileSync(scheduleFile(workspace), '{ not json')
    const app = await startForTools({ THEOCLAW_WORKSPACE: workspace }, workspace, { detect: notEnforced })
    await stop(app)
    expect(app.error).toBeInstanceOf(ScheduleStoreError)
    expect(app.error?.message).toContain('schedules.json')
    expect(app.builds()).toBe(0)
  })
})
