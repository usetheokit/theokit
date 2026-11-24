import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PlatformName, SendResult } from '@theokit/gateway'
import { createJobStore, type JobStore, ScheduleStoreError } from '@theokit/agents/tools'
import type { AgentOptions } from '@theokit/sdk'
import { Cron } from '@theokit/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TurnAgent, TurnRun } from '../src/agent-port.js'
import type { StartedPlatform } from '../src/channels/channel-loop.js'
import { agentOptionsFor } from '../src/control-plane/agent-factory.js'
import type { AgentToolOptions } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { inboxFile, INBOX_LIMIT } from '../src/scheduler/schedule-inbox.js'
import {
  type RunningScheduler,
  scheduleFile,
  wireScheduler,
} from '../src/scheduler/scheduler-wiring.js'
import { fakeBuilders, signedLinePost } from './composition-fixtures.js'
import { FakeAdapter, FakeAgent, waitFor } from './fakes.js'
import { notEnforced, runControlTurn, startForTools, stop, tempCwd } from './tool-start-fixtures.js'

const SCHEDULE_TOOLS = [
  'schedule_job',
  'list_scheduled_jobs',
  'cancel_scheduled_job',
  'read_schedule_inbox',
]

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
      async *stream() {
        yield { type: 'assistant' }
      },
      cancel: () => Promise.resolve(),
      wait: () =>
        answer !== undefined
          ? Promise.resolve({ status: 'finished', result: answer })
          : new Promise((resolve) => {
              signal?.addEventListener('abort', () => resolve({ status: 'cancelled' }), {
                once: true,
              })
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
  workspace?: string,
  platforms: readonly string[] = ['telegram', 'slack'],
): Promise<RunningScheduler> {
  running = wireScheduler({
    store,
    loop: { started },
    buildRunAgent: (options) => {
      built.push(options)
      return agent
    },
    tools: resolveToolSettings({}, dir, { detect: notEnforced, warn: () => undefined }),
    platforms,
    ...(workspace === undefined ? {} : { workspace }),
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

describe('wireScheduler inbox', () => {
  const inboxJob = { ...job('inbox'), target: { platform: 'inbox', channelId: 'main' } }

  it('delivers to the local inbox with no platform connected, masked, and the tool reads it', async () => {
    const { scheduler, scheduleTools } = await start(
      new AnsweringAgent('good morning sk-live-123'),
      [],
      ['sk-live-123'],
      dir,
    )
    await scheduler.add(inboxJob)
    expect(await scheduler.fire('job-1')).toBe('delivered')
    const read = scheduleTools.find((tool) => tool.name === 'read_schedule_inbox')!
    const out = JSON.parse(String(await read.handler({}, undefined as never))) as {
      messages: { text: string; channelId: string }[]
    }
    expect(out.messages).toHaveLength(1)
    expect(out.messages[0]?.channelId).toBe('main')
    expect(out.messages[0]?.text).toContain('good morning')
    expect(out.messages[0]?.text).not.toContain('sk-live-123')
  })

  const readInbox = async (tools: RunningScheduler['scheduleTools']) =>
    JSON.parse(
      String(
        await tools
          .find((tool) => tool.name === 'read_schedule_inbox')!
          .handler({ limit: INBOX_LIMIT }, undefined as never),
      ),
    ) as {
      error?: string
      messages: { text: string }[]
    }

  it('schedules through the tool with no configured platform and delivers', async () => {
    const { scheduler, scheduleTools } = await start(
      new AnsweringAgent('good morning'),
      [],
      [],
      dir,
      [],
    )
    const schedule = scheduleTools.find((tool) => tool.name === 'schedule_job')!
    const out = JSON.parse(
      String(
        await schedule.handler(
          { cron: '@daily', prompt: 'say it', platform: 'inbox', channelId: 'main' },
          undefined as never,
        ),
      ),
    ) as { ok: boolean; id?: string }
    expect(out.ok).toBe(true)
    const [stored] = store.list()
    expect(await scheduler.fire(stored!.id)).toBe('delivered')
    expect((await readInbox(scheduleTools)).messages.map((m) => m.text)).toEqual(['good morning'])
  })

  it('refuses an unknown platform even when the inbox is available', async () => {
    const { scheduleTools } = await start(new AnsweringAgent('x'), [], [], dir, [])
    const schedule = scheduleTools.find((tool) => tool.name === 'schedule_job')!
    const out = JSON.parse(
      String(
        await schedule.handler(
          { cron: '@daily', prompt: 'hi', platform: 'web', channelId: 'main' },
          undefined as never,
        ),
      ),
    ) as { ok: boolean }
    expect(out.ok).toBe(false)
    expect(store.list()).toHaveLength(0)
  })

  it('keeps the messages across a restart', async () => {
    const first = await start(new AnsweringAgent('one'), [], [], dir, [])
    await first.scheduler.add(inboxJob)
    await first.scheduler.fire('job-1')
    await running?.stop()
    const second = await start(new AnsweringAgent('two'), [], [], dir, [])
    await second.scheduler.fire('job-1')
    expect((await readInbox(second.scheduleTools)).messages.map((m) => m.text)).toEqual([
      'one',
      'two',
    ])
  })

  it('keeps only the latest messages', async () => {
    const { scheduler, scheduleTools } = await start(new AnsweringAgent('m'), [], [], dir, [])
    await scheduler.add(inboxJob)
    for (let i = 0; i < INBOX_LIMIT + 3; i++) await scheduler.fire('job-1')
    expect((await readInbox(scheduleTools)).messages).toHaveLength(INBOX_LIMIT)
    expect(JSON.parse(readFileSync(inboxFile(dir), 'utf8'))).toHaveLength(INBOX_LIMIT)
  })

  it('reports undelivered and keeps the output when the inbox cannot be written', async () => {
    // a directory where the file belongs: the write fails
    mkdirSync(inboxFile(dir), { recursive: true })
    const { scheduler } = await start(new AnsweringAgent('kept'), [], [], dir, [])
    await scheduler.add(inboxJob)
    expect(await scheduler.fire('job-1')).toBe('undelivered')
    expect(lines).toContain('scheduler: job news: inbox: inbox_write_failed')
    expect(store.get('job-1')?.previousOutput).toBe('kept')
  })

  it('does not overwrite a malformed inbox and reports undelivered', async () => {
    mkdirSync(join(dir, '.theoclaw'), { recursive: true })
    writeFileSync(inboxFile(dir), '{ not json')
    const { scheduler, scheduleTools } = await start(new AnsweringAgent('new'), [], [], dir, [])
    await scheduler.add(inboxJob)
    expect(await scheduler.fire('job-1')).toBe('undelivered')
    expect(readFileSync(inboxFile(dir), 'utf8')).toBe('{ not json')
    expect((await readInbox(scheduleTools)).error).toContain('cannot be read')
  })

  it('delivers a failed run message to the inbox', async () => {
    const failing: TurnAgent = { send: () => Promise.reject(new Error('boom')) }
    const { scheduler, scheduleTools } = await start(failing, [], [], dir, [])
    await scheduler.add(inboxJob)
    expect(await scheduler.fire('job-1')).toBe('failed')
    const { messages } = await readInbox(scheduleTools)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.text).toContain('failed: boom')
  })

  it.each([
    ['an error with a code', { status: 'error', error: { code: 'rate_limited' } }, 'failed: run ended with error: rate_limited'],
    ['a cancelled run', { status: 'cancelled' }, 'failed: run ended with status cancelled'],
    ['a finished run with no answer', { status: 'finished' }, 'failed: run finished without a result'],
  ])('names why %s failed, and never reads its stream', async (_name, outcome, text) => {
    const stream = vi.fn(async function* () {
      yield { type: 'assistant' }
    })
    const agent: TurnAgent = {
      send: () => Promise.resolve({ stream, cancel: () => Promise.resolve(), wait: () => Promise.resolve(outcome) }),
    }
    const { scheduler, scheduleTools } = await start(agent, [], [], dir, [])
    await scheduler.add(inboxJob)
    expect(await scheduler.fire('job-1')).toBe('failed')
    expect((await readInbox(scheduleTools)).messages?.[0]?.text).toContain(text)
    expect(stream).not.toHaveBeenCalled()
  })

  it('refuses the inbox target without a workspace', async () => {
    const { scheduleTools } = await start(new AnsweringAgent('x'))
    expect(scheduleTools.map((tool) => tool.name)).not.toContain('read_schedule_inbox')
    const schedule = scheduleTools.find((tool) => tool.name === 'schedule_job')!
    const out = JSON.parse(
      String(
        await schedule.handler(
          { cron: '@daily', prompt: 'hi', platform: 'inbox', channelId: 'main' },
          undefined as never,
        ),
      ),
    ) as { ok: boolean }
    expect(out.ok).toBe(false)
  })

  it('tells the model the inbox is local and its channel id is a free label', async () => {
    const { scheduleTools } = await start(new AnsweringAgent('x'), [], [], dir)
    const schedule = scheduleTools.find((tool) => tool.name === 'schedule_job')!
    expect(schedule.description).toContain('read_schedule_inbox')
    const channel = (schedule.inputSchema as { properties: { channelId: { description: string } } })
      .properties.channelId
    expect(channel.description).toContain('do not ask the user for an id')
  })

  it('accepts the inbox target through schedule_job when a workspace is given', async () => {
    const { scheduleTools } = await start(new AnsweringAgent('x'), [], [], dir)
    const schedule = scheduleTools.find((tool) => tool.name === 'schedule_job')!
    const out = JSON.parse(
      String(
        await schedule.handler(
          { cron: '@daily', prompt: 'hi', platform: 'inbox', channelId: 'main' },
          undefined as never,
        ),
      ),
    ) as { ok: boolean }
    expect(out.ok).toBe(true)
  })
})

describe('wireScheduler', () => {
  it('delivers a fired job through the adapter the loop connected', async () => {
    const telegram = new FakeAdapter('telegram')
    connect(telegram)
    const { scheduler } = await start(new AnsweringAgent('hello there'))
    await scheduler.add(job())
    expect(await scheduler.fire('job-1')).toBe('delivered')
    expect(telegram.sent).toEqual([{ channel: { id: '42', type: 'group' }, text: 'hello there', format: 'plain' }])
    expect(lines[0]).toBe('scheduler: 0 jobs, heartbeat off')
  })

  it('sends the run with its abort signal and no per-send untrusted content options, which the agent sendDefaults carries (OC-88)', async () => {
    connect(new FakeAdapter('telegram'))
    const agent = new AnsweringAgent('ok')
    const { scheduler } = await start(agent)
    await scheduler.add(job())
    await scheduler.fire('job-1')
    expect(agent.options[0]).not.toHaveProperty('toolResultGuard')
    expect(agent.signals[0]).toBeInstanceOf(AbortSignal)
  })

  it('masks a configured value in the delivered answer (OC-90)', async () => {
    const telegram = new FakeAdapter('telegram')
    connect(telegram)
    const { scheduler } = await start(
      new AnsweringAgent('the key is sk-live-123, keep it'),
      [],
      ['sk-live-123'],
    )
    await scheduler.add(job())
    expect(await scheduler.fire('job-1')).toBe('delivered')
    const sent = telegram.sent.map((message) => message.text).join('\n')
    expect(sent).not.toContain('sk-live-123')
    expect(sent).toContain('the key is')
  })

  it('passes the previous output to the next run and lets that run suppress delivery', async () => {
    const telegram = new FakeAdapter('telegram')
    connect(telegram)
    const prompts: string[] = []
    const agent = new AnsweringAgent('first output')
    const send = agent.send.bind(agent)
    agent.send = (text, options) => {
      prompts.push(text)
      return prompts.length === 1
        ? send(text, options)
        : new AnsweringAgent('[SILENT]').send(text, options)
    }
    const { scheduler } = await start(agent)
    await scheduler.add(job())
    expect(await scheduler.fire('job-1')).toBe('delivered')
    expect(await scheduler.fire('job-1')).toBe('suppressed')
    expect(prompts[1]).toContain('first output')
    expect(telegram.sent).toHaveLength(1)
  })

  it('prints one line when a delivery has no adapter', async () => {
    const { scheduler } = await start(new AnsweringAgent('hello'))
    await scheduler.add(job('slack'))
    expect(await scheduler.fire('job-1')).toBe('undelivered')
    expect(lines).toContain('scheduler: job news: slack: not_started')
    expect(store.get('job-1')?.previousOutput).toBe('hello')
  })

  it('reports adapter_threw and keeps the output when the adapter throws on send', async () => {
    connect(
      new FakeAdapter('telegram', {
        send: () => {
          throw new Error('socket closed')
        },
      }),
    )
    const { scheduler } = await start(new AnsweringAgent('hello'))
    await scheduler.add(job())
    expect(await scheduler.fire('job-1')).toBe('undelivered')
    expect(lines).toContain('scheduler: job news: telegram: adapter_threw')
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
    for (const name of [...SCHEDULE_TOOLS, 'run_code', 'delegate_all'])
      expect(names).not.toContain(name)
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
    connect(
      new FakeAdapter('telegram', {
        send: (): Promise<SendResult> => Promise.reject(new Error('socket closed')),
      }),
    )
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
    const app = await startForTools({ THEOCLAW_WORKSPACE: workspace }, workspace, {
      detect: notEnforced,
    })
    try {
      expect(app.error).toBeUndefined()
      const options = await runControlTurn(app)
      const names = options.tools.map((tool) => tool.name)
      for (const name of SCHEDULE_TOOLS) expect(names).toContain(name)
      expect(
        (agentOptionsFor({ THEOCLAW_MODEL: 'openrouter/m', THEOKIT_API_KEY: 'k' }).tools ?? []).map(
          (tool) => tool.name,
        ),
      ).toEqual(['skill_read'])
      expect(app.output()).toContain('scheduler: 0 jobs, heartbeat off')
    } finally {
      await stop(app)
    }
  })

  it('opens a chat agent with no schedule tool in a start that has the scheduler', async () => {
    const workspace = tempCwd(cleanups)
    const received: AgentOptions[] = []
    const app = await startForTools(
      { THEOCLAW_WORKSPACE: workspace },
      workspace,
      { detect: notEnforced },
      {
        getOrCreate: (_id, options) => {
          received.push(options)
          return Promise.resolve(
            Object.assign(new FakeAgent({ frames: [] }), { dispose: () => Promise.resolve() }),
          )
        },
      },
    )
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
    const app = await startForTools(
      { THEOCLAW_WORKSPACE: workspace },
      workspace,
      { detect: notEnforced },
      {
        builders,
        signals,
        exit: () => exited(),
        importFreeAgentFactory: () => runAgent,
      },
    )
    expect(app.error).toBeUndefined()
    const sdkJob = (await Cron.list({ runtime: 'local' })).items.find(
      (item) => item.name === 'job-sigterm',
    )
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
    const app = await startForTools({ THEOCLAW_WORKSPACE: workspace }, workspace, {
      detect: notEnforced,
    })
    await stop(app)
    expect(app.error).toBeInstanceOf(ScheduleStoreError)
    expect(app.error?.message).toContain('schedules.json')
    expect(app.builds()).toBe(0)
  })
})
