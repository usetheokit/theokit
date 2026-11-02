import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PlatformName } from '@theokit/gateway'
import { createJobStore, type JobStore } from '@theokit/agents/tools'
import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent, theoClawAgentOptions } from '../../src/agent/create-agent.js'
import type { TurnAgent } from '../../src/agent-port.js'
import type { StartedPlatform } from '../../src/channels/channel-loop.js'
import { HEARTBEAT_FILE, heartbeatJob, readHeartbeatSettings } from '../../src/scheduler/heartbeat.js'
import { type RunningScheduler, scheduleFile, wireScheduler } from '../../src/scheduler/scheduler-wiring.js'
import { type AgentToolOptions, controlAgentToolOptions } from '../../src/tools/tool-registry.js'
import { resolveToolSettings } from '../../src/tools/tool-settings.js'
import type { ToolSettings } from '../../src/tools/tool-settings.js'
import { FakeAdapter, turnText } from '../fakes.js'
import { makeHostToolsWorkspace } from '../host-tools-workspace.js'

/**
 * B-396 (OC-84, OC-85, H-4): scheduled runs on a real model, through the app's own wiring
 * (`wireScheduler`, the `/control` agent's tool options, `createTheoClawAgent`) and the real
 * `DeliveryRouter`, over a recording adapter. It runs only with THEOCLAW_LIVE=1; without it the
 * cases skip and CI stays offline. Every answer the cases look for holds a nonce made at test time.
 */
const LIVE = process.env.THEOCLAW_LIVE === '1'
const LIVE_TIMEOUT_MS = 180_000
/** The OC-84 case waits for a real minute tick: at most 60 s, plus the scheduled run itself. */
const TICK_DEADLINE_MS = 75_000

function liveModel(): { readonly model: string; readonly apiKey: string } {
  const model = process.env.THEOCLAW_MODEL
  const apiKey = process.env.THEOKIT_API_KEY ?? process.env.OPENROUTER_API_KEY
  if (!model) throw new Error('THEOCLAW_LIVE=1 needs THEOCLAW_MODEL')
  if (!apiKey) throw new Error('THEOCLAW_LIVE=1 needs THEOKIT_API_KEY or OPENROUTER_API_KEY')
  return { model, apiKey }
}

const nonce = (): string => `n${randomBytes(4).toString('hex')}`

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

interface Rig {
  /** The workspace: `.theoclaw/schedules.json` and `HEARTBEAT.md` live here, as in the app. */
  readonly workspace: string
  readonly settings: ToolSettings
  readonly telegram: FakeAdapter
  readonly prompts: string[]
  readonly build: (toolOptions: AgentToolOptions) => Promise<TurnAgent>
}

/** A workspace, a recording Telegram adapter, and the app's agent factory, recording each run's prompt. */
function rig(): Rig {
  const workspace = makeHostToolsWorkspace()
  cleanups.push(() => workspace.remove())
  const settings = resolveToolSettings({}, workspace.path)
  const { model, apiKey } = liveModel()
  const prompts: string[] = []
  const build = async (toolOptions: AgentToolOptions): Promise<TurnAgent> => {
    const agent = await createTheoClawAgent(theoClawAgentOptions({ model, apiKey, toolOptions }))
    return {
      send: (text, options) => {
        prompts.push(turnText(text))
        return agent.send(text, options)
      },
      [Symbol.asyncDispose]: () => agent[Symbol.asyncDispose](),
    } as TurnAgent
  }
  return { workspace: workspace.path, settings, telegram: new FakeAdapter('telegram'), prompts, build }
}

/** Wire and start the scheduler as `startTheoClaw` does, over `rig`'s adapter. */
async function scheduler(r: Rig, store: JobStore, heartbeat?: Parameters<typeof wireScheduler>[0]['heartbeat']): Promise<RunningScheduler> {
  const started = new Map<PlatformName, StartedPlatform>([['telegram', { adapter: r.telegram } as unknown as StartedPlatform]])
  const running = wireScheduler({
    store,
    loop: { started },
    buildRunAgent: r.build,
    tools: r.settings,
    platforms: ['telegram'],
    ...(heartbeat === undefined ? {} : { heartbeat }),
    write: (line) => process.stderr.write(`${line}\n`),
  })
  cleanups.push(() => running.stop())
  await running.start()
  return running
}

/** One turn of a `/control` agent holding the schedule tools; fails naming the status when it does not finish. */
async function controlTurn(r: Rig, running: RunningScheduler, prompt: string): Promise<string> {
  const agent = await r.build(controlAgentToolOptions(r.settings, r.build, running.scheduleTools))
  try {
    const run = await agent.send(prompt)
    const outcome = await run.wait()
    if (outcome.status !== 'finished') throw new Error(`the control turn ended ${outcome.status}: ${JSON.stringify(outcome)}`)
    return String(outcome.result ?? '')
  } finally {
    await (agent as unknown as AsyncDisposable)[Symbol.asyncDispose]()
  }
}

async function until(condition: () => boolean, deadlineMs: number, what: string): Promise<void> {
  const deadline = Date.now() + deadlineMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`never happened within ${String(deadlineMs)} ms: ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

describe.skipIf(!LIVE)('scheduled runs against a real model', () => {
  it('a real model schedules a job from a sentence and it delivers unattended for OC-84', { timeout: LIVE_TIMEOUT_MS }, async () => {
    const r = rig()
    const store = createJobStore(scheduleFile(r.workspace))
    const running = await scheduler(r, store)
    const tick = nonce()
    expect(store.list()).toEqual([])

    await controlTurn(
      r,
      running,
      `Every minute, post to telegram channel 42 the answer to: reply with exactly "tick ${tick}". ` +
        'Use the schedule_job tool once, with the cron "* * * * *", then confirm in one sentence.',
    )

    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]?.target).toEqual({ platform: 'telegram', channelId: '42' })
    // Nothing calls `fire` here: only the SDK Cron's minute tick can produce this send.
    await until(() => r.telegram.sent.some((message) => message.text.includes(`tick ${tick}`)), TICK_DEADLINE_MS, `a send holding "tick ${tick}"`)
    expect(r.telegram.sent[0]?.channel.id).toBe('42')
  })

  it("a real model's second run after a restart sees the first run's output and a SILENT run sends nothing for H-4", { timeout: LIVE_TIMEOUT_MS }, async () => {
    const r = rig()
    const file = scheduleFile(r.workspace)
    const first = nonce()
    const job = {
      id: 'job-h4',
      name: 'continuity',
      cron: '0 0 1 1 *',
      prompt:
        'If a previous output is shown above, reply with exactly that previous output followed by " again" and nothing else. ' +
        `Otherwise reply with exactly "first ${first}" and nothing else.`,
      target: { platform: 'telegram', channelId: '42' },
      createdAt: Date.now(),
    }
    const before = await scheduler(r, createJobStore(file))
    await before.scheduler.add(job)
    expect(await before.scheduler.fire('job-h4')).toBe('delivered')
    await before.stop()

    // A restart: a new store read from disk and a new scheduler.
    const after = await scheduler(r, createJobStore(file))
    expect(await after.scheduler.fire('job-h4')).toBe('delivered')
    expect(r.prompts[1]).toContain(`first ${first}`)
    expect(r.telegram.sent.map((message) => message.text)).toEqual([
      expect.stringContaining(`first ${first}`),
      expect.stringContaining(`first ${first} again`),
    ])

    await after.scheduler.add({ ...job, id: 'job-silent', name: 'silent', prompt: 'Reply with exactly [SILENT] and nothing else.' })
    expect(await after.scheduler.fire('job-silent')).toBe('suppressed')
    expect(r.telegram.sent).toHaveLength(2)
    expect(createJobStore(file).get('job-silent')?.previousOutput?.trim()).toBe('[SILENT]')
  })

  it('a real model answers the heartbeat from HEARTBEAT.md and stays silent when told to for OC-85', { timeout: LIVE_TIMEOUT_MS }, async () => {
    const r = rig()
    const { workspace } = r
    const beat = nonce()
    const settings = readHeartbeatSettings({ THEOCLAW_HEARTBEAT: '0 0 1 1 * telegram:42' })
    if (settings === undefined) throw new Error('the heartbeat was not read')
    const running = await scheduler(r, createJobStore(scheduleFile(workspace)), heartbeatJob(workspace, settings))

    writeFileSync(join(workspace, HEARTBEAT_FILE), `Reply with exactly "beat ${beat}" and nothing else.\n`)
    expect(await running.scheduler.fire('heartbeat')).toBe('delivered')
    expect(r.telegram.sent.map((message) => message.text)).toEqual([expect.stringContaining(`beat ${beat}`)])

    writeFileSync(join(workspace, HEARTBEAT_FILE), 'Reply with exactly [SILENT] and nothing else.\n')
    expect(await running.scheduler.fire('heartbeat')).toBe('suppressed')
    expect(r.telegram.sent).toHaveLength(1)
  })
})
