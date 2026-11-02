import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PlatformName } from '@theokit/gateway'
import { createJobStore } from '@theokit/agents/tools'
import { Cron } from '@theokit/sdk'
import { fn, Workflow } from '@theokit/sdk/workflow'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { TurnAgent, TurnRun } from '../src/agent-port.js'
import type { StartedPlatform } from '../src/channels/channel-loop.js'
import { PLATFORMS } from '../src/channels/platforms.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'
import { HEARTBEAT_FILE, heartbeatJob, readHeartbeatSettings } from '../src/scheduler/heartbeat.js'
import { type RunningScheduler, scheduleFile, wireScheduler } from '../src/scheduler/scheduler-wiring.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { FakeAdapter } from './fakes.js'
import { notEnforced, startForTools, stop, tempCwd } from './tool-start-fixtures.js'

/** An agent that records each prompt and answers `beat`. */
class RecordingAgent implements TurnAgent {
  readonly prompts: string[] = []

  send(text: string): Promise<TurnRun> {
    this.prompts.push(text)
    return Promise.resolve({
      // eslint-disable-next-line @typescript-eslint/require-await -- the port's stream is async
      async *stream() {
        yield { type: 'assistant' }
      },
      cancel: () => Promise.resolve(),
      wait: () => Promise.resolve({ status: 'finished', result: 'beat' }),
    })
  }
}

/** Every platform configured: the tests of the variable's shape. */
const TEN = PLATFORMS.map((spec) => spec.platform)

/** A workflow that does nothing, to ask the SDK whether it accepts a cron. */
const probe = () => Workflow.create({ name: 'probe' }).then(fn('noop', () => 'ok')).commit()

let dir: string
let running: RunningScheduler | undefined
const cleanups: (() => void)[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'heartbeat-'))
})

afterEach(async () => {
  await running?.stop()
  running = undefined
  rmSync(dir, { recursive: true, force: true })
  for (const cleanup of cleanups.splice(0)) cleanup()
})

async function startWithHeartbeat(agent: RecordingAgent, telegram: FakeAdapter): Promise<RunningScheduler> {
  const settings = readHeartbeatSettings({ THEOCLAW_HEARTBEAT: '*/30 * * * * telegram:-100200' }, ['telegram'])
  if (settings === undefined) throw new Error('the heartbeat was not read')
  const started = new Map<PlatformName, StartedPlatform>([['telegram', { adapter: telegram } as unknown as StartedPlatform]])
  running = wireScheduler({
    store: createJobStore(scheduleFile(dir)),
    loop: { started },
    buildRunAgent: () => agent,
    tools: resolveToolSettings({}, dir, { detect: notEnforced, warn: () => undefined }),
    platforms: ['telegram'],
    heartbeat: heartbeatJob(dir, settings),
    write: () => undefined,
  })
  await running.start()
  return running
}

describe('the heartbeat', () => {
  it('runs the heartbeat on the prompt in HEARTBEAT.md', async () => {
    writeFileSync(join(dir, HEARTBEAT_FILE), 'Check the build and report.\n')
    const agent = new RecordingAgent()
    const telegram = new FakeAdapter('telegram')
    const { scheduler } = await startWithHeartbeat(agent, telegram)
    expect(await scheduler.fire('heartbeat')).toBe('delivered')
    expect(agent.prompts[0]).toContain('Task:\nCheck the build and report.')
    expect(telegram.sent).toEqual([{ channel: { id: '-100200', type: 'group' }, text: 'beat' }])
  })

  it('reads HEARTBEAT.md again on each fire', async () => {
    writeFileSync(join(dir, HEARTBEAT_FILE), 'Check the build and report.')
    const agent = new RecordingAgent()
    const { scheduler } = await startWithHeartbeat(agent, new FakeAdapter('telegram'))
    await scheduler.fire('heartbeat')
    writeFileSync(join(dir, HEARTBEAT_FILE), 'Now check the queue.')
    await scheduler.fire('heartbeat')
    expect(agent.prompts[1]).toContain('Task:\nNow check the queue.')
  })

  it("carries the heartbeat's previous output into its next prompt", async () => {
    writeFileSync(join(dir, HEARTBEAT_FILE), 'Check the build and report.')
    const agent = new RecordingAgent()
    const { scheduler } = await startWithHeartbeat(agent, new FakeAdapter('telegram'))
    await scheduler.fire('heartbeat')
    await scheduler.fire('heartbeat')
    expect(agent.prompts[0]).not.toContain('<previous-output>')
    expect(agent.prompts[1]).toContain('<previous-output>\nbeat\n</previous-output>')
  })

  it('calls no model when HEARTBEAT.md is blank', async () => {
    const agent = new RecordingAgent()
    const telegram = new FakeAdapter('telegram')
    const { scheduler } = await startWithHeartbeat(agent, telegram)
    expect(await scheduler.fire('heartbeat')).toBe('empty')
    writeFileSync(join(dir, HEARTBEAT_FILE), '  \n\n')
    expect(await scheduler.fire('heartbeat')).toBe('empty')
    expect(agent.prompts).toEqual([])
    expect(telegram.sent).toEqual([])
  })

  it('is off when THEOCLAW_HEARTBEAT is unset or blank', () => {
    expect(readHeartbeatSettings({}, TEN)).toBeUndefined()
    expect(readHeartbeatSettings({ THEOCLAW_HEARTBEAT: '  ' }, TEN)).toBeUndefined()
  })

  it('reads a shorthand cron and its target', () => {
    expect(readHeartbeatSettings({ THEOCLAW_HEARTBEAT: '@hourly slack:C123' }, TEN)).toEqual({
      cron: '@hourly',
      target: { platform: 'slack', channelId: 'C123' },
    })
  })

  it('refuses THEOCLAW_HEARTBEAT with no target naming the variable', () => {
    const refusal = () => readHeartbeatSettings({ THEOCLAW_HEARTBEAT: '*/30 * * * *' }, TEN)
    expect(refusal).toThrow(TheoClawConfigError)
    expect(refusal).toThrow(expect.objectContaining({ variable: 'THEOCLAW_HEARTBEAT' }))
    expect(refusal).toThrow('THEOCLAW_HEARTBEAT')
  })

  it('refuses a heartbeat platform outside the ten', () => {
    const refusal = () => readHeartbeatSettings({ THEOCLAW_HEARTBEAT: '@daily myspace:42' }, TEN)
    expect(refusal).toThrow(TheoClawConfigError)
    expect(refusal).toThrow(/THEOCLAW_HEARTBEAT.*myspace/)
  })

  it('refuses a heartbeat platform that is not configured (F-wire-2)', () => {
    const refusal = () => readHeartbeatSettings({ THEOCLAW_HEARTBEAT: '@daily slack:C1' }, ['telegram'])
    expect(refusal).toThrow(TheoClawConfigError)
    expect(refusal).toThrow(/THEOCLAW_HEARTBEAT.*slack.*not configured/)
  })

  it('refuses the start on a heartbeat to an unconfigured platform (F-wire-2)', async () => {
    const workspace = tempCwd(cleanups)
    const app = await startForTools(
      { THEOCLAW_WORKSPACE: workspace, THEOCLAW_HEARTBEAT: '@daily slack:C1' },
      workspace,
      { detect: notEnforced },
    )
    await stop(app)
    expect(app.error).toBeInstanceOf(TheoClawConfigError)
    expect(app.builds()).toBe(0)
  })

  it('refuses a heartbeat cron the SDK rejects', async () => {
    for (const cron of ['99 * * * *', '*/0 * * * *', '@fortnightly', '* * * *', '5-1 * * * *']) {
      const refusal = () => readHeartbeatSettings({ THEOCLAW_HEARTBEAT: `${cron} telegram:42` }, TEN)
      expect(refusal, cron).toThrow(TheoClawConfigError)
      expect(refusal, cron).toThrow('THEOCLAW_HEARTBEAT')
      await expect(Cron.create({ cron, enabled: false, workflow: probe() }), cron).rejects.toThrow(/cron/i)
    }
  })

  it('accepts every cron the SDK accepts', async () => {
    for (const cron of ['*/15 * * * *', '0 9 * * 1-5', '0,30 8-18 * * *', '0 0 1 1 *', '@weekly']) {
      expect(readHeartbeatSettings({ THEOCLAW_HEARTBEAT: `${cron} telegram:42` }, TEN)?.cron, cron).toBe(cron)
      const created = await Cron.create({ cron, enabled: false, workflow: probe() })
      await Cron.delete(created.id)
    }
  })

  it('refuses the start on a malformed THEOCLAW_HEARTBEAT before any channel connects', async () => {
    const workspace = tempCwd(cleanups)
    const app = await startForTools(
      { THEOCLAW_WORKSPACE: workspace, THEOCLAW_HEARTBEAT: 'every minute' },
      workspace,
      { detect: notEnforced },
    )
    await stop(app)
    expect(app.error).toBeInstanceOf(TheoClawConfigError)
    expect(app.builds()).toBe(0)
  })

  it('announces the heartbeat in the start line', async () => {
    const workspace = tempCwd(cleanups)
    const app = await startForTools(
      { THEOCLAW_WORKSPACE: workspace, THEOCLAW_HEARTBEAT: '@daily telegram:42' },
      workspace,
      { detect: notEnforced },
    )
    try {
      expect(app.error).toBeUndefined()
      expect(app.output()).toContain('scheduler: 0 jobs, heartbeat on')
    } finally {
      await stop(app)
    }
  })
})
