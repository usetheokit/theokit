// B-396 — where the framework's scheduler meets the product: the store under the workspace, a run
// port over a read-only worker agent, and a delivery port over the adapters the channel loop has
// connected. The only module of the app that builds a `DeliveryRouter`.
import { join } from 'node:path'

import {
  createJobStore,
  createScheduler,
  createScheduleTools,
  type DeliverPort,
  type JobStore,
  type RunPort,
  type Scheduler,
} from '@theokit/agents/tools'
import { DeliveryRouter } from '@theokit/gateway'
import type { PlatformName } from '@theokit/gateway'
import type { CustomTool } from '@theokit/sdk'

import { untrustedContentSendOptions } from '../agent/untrusted-content.js'
import { createContainer } from '../agent-container.js'
import type { TurnAgent } from '../agent-port.js'
import { type ChannelLoop, maskSecrets } from '../channels/channel-loop.js'
import { type AgentToolOptions, workerToolOptions } from '../tools/tool-registry.js'
import type { ToolSettings } from '../tools/tool-settings.js'

import { openPostgresJobStore, readDatabaseSetting } from './postgres-job-store.js'

/** Where the durable jobs are kept: beside `sessions.json`, in the directory the start makes with 0700. */
export function scheduleFile(workspace: string): string {
  return join(workspace, '.theoclaw', 'schedules.json')
}

/**
 * Open the job store, synchronously so the start can refuse a malformed file (`ScheduleStoreError`)
 * before it installs anything, with no await that could let a signal pass unhandled.
 */
export function loadScheduleStore(workspace: string): JobStore {
  return createJobStore(scheduleFile(workspace))
}

/**
 * The job store the start uses: the file, or PostgreSQL when `THEOCLAW_DATABASE` is a postgres URL
 * (#1565). A database that cannot be opened refuses the start; it never falls back to the file.
 */
export async function openScheduleStore(
  workspace: string,
  env: Readonly<Record<string, string | undefined>>,
): Promise<{ store: JobStore; close(): Promise<void> }> {
  const setting = readDatabaseSetting(env)
  if (setting.engine === 'postgres') return openPostgresJobStore(setting.dsn)
  return { store: loadScheduleStore(workspace), close: () => Promise.resolve() }
}

/** Builds one agent from tool options: the start's worker factory. */
export type BuildRunAgent = (toolOptions: AgentToolOptions) => TurnAgent | Promise<TurnAgent>

/**
 * A scheduled run's agent options: the read-only worker's, which hold no schedule tool, so a
 * scheduled run cannot schedule whatever its prompt says (plan D3, REQ-9 property 3).
 */
function runAgentToolOptions(tools: ToolSettings): AgentToolOptions {
  return workerToolOptions(tools)
}

/**
 * Run one prompt on a fresh worker agent inside its own request boundary, which disposes it. A run
 * that ends `error` or `cancelled`, or with no answer, is a failure naming its status or code.
 */
function createRunPort(buildRunAgent: BuildRunAgent, tools: ToolSettings): RunPort {
  const { withAgent } = createContainer<TurnAgent>({
    factory: () => buildRunAgent(runAgentToolOptions(tools)),
  })
  return (prompt, signal) =>
    withAgent(async (agent) => {
      const run = await agent.send(prompt, { ...untrustedContentSendOptions(), signal })
      const outcome = await run.wait()
      if (
        outcome.status === 'error' ||
        outcome.status === 'cancelled' ||
        outcome.result === undefined
      ) {
        return { ok: false, error: outcome.error?.code ?? `the run ended ${outcome.status}` }
      }
      return { ok: true, text: outcome.result }
    })
}

/**
 * Deliver through a `DeliveryRouter` built at each send from the adapters connected by then, so a
 * platform that connects after the start is reached. The text is masked first, as a chat reply and a
 * broadcast answer are (OC-90), so a configured value never reaches a channel. An adapter that throws
 * is reported as `adapter_threw`: `DeliveryRouter.send` does not catch it.
 */
function createDeliverPort(
  loop: Pick<ChannelLoop, 'started'>,
  secrets: readonly string[] = [],
): DeliverPort {
  return async (target, text) => {
    const router = new DeliveryRouter()
    for (const { adapter } of loop.started.values()) router.register(adapter)
    try {
      return await router.send({
        platform: target.platform as PlatformName,
        // As the broadcast send does: a scheduled answer goes to a channel, not a reply thread.
        channel: { id: target.channelId, type: 'group' },
        text: maskSecrets(text, secrets),
      })
    } catch {
      return { ok: false, error: { code: 'adapter_threw' } }
    }
  }
}

/** A transient job the scheduler runs beside the stored ones (the heartbeat, T2.2). */
export interface TransientSchedule {
  readonly id: string
  readonly cron: string
  readonly target: { readonly platform: string; readonly channelId: string }
  readonly prompt: () => Promise<string | undefined>
}

export interface WireSchedulerOptions {
  readonly store: JobStore
  readonly loop: Pick<ChannelLoop, 'started'>
  readonly buildRunAgent: BuildRunAgent
  readonly tools: ToolSettings
  /** The platforms a job may target: the configured ones. */
  readonly platforms: readonly string[]
  readonly heartbeat?: TransientSchedule
  /** The scheduled team report (OC-142). */
  readonly teamReport?: TransientSchedule
  readonly write: (line: string) => void
  /** The configured values masked out of every delivered answer (OC-90). */
  readonly secrets?: readonly string[]
}

export interface RunningScheduler {
  readonly scheduler: Scheduler
  /** `schedule_job`, `list_scheduled_jobs` and `cancel_scheduled_job`, for `/control` agents only. */
  readonly scheduleTools: CustomTool[]
  /**
   * Register the stored jobs and the heartbeat with the SDK `Cron`, start its timer, and print one
   * line. Does nothing once `stop()` ran, so a shutdown during the host's start leaves no timer.
   */
  start(): Promise<void>
  /** Abort in-flight runs, then remove the timers. Called before the loop stops (EC-2). */
  stop(): Promise<void>
}

/**
 * Build the scheduler, its ports and its tools. Nothing is registered until `start()`, so the host
 * can hand the tools to its `/control` agents while its own start is still synchronous.
 */
export function wireScheduler(options: WireSchedulerOptions): RunningScheduler {
  const scheduler = createScheduler({
    store: options.store,
    run: createRunPort(options.buildRunAgent, options.tools),
    deliver: createDeliverPort(options.loop, options.secrets),
    write: options.write,
  })
  const { heartbeat } = options
  let stopped = false
  return {
    scheduler,
    scheduleTools: createScheduleTools({ scheduler, platforms: options.platforms }),
    async start() {
      if (stopped) return
      for (const transient of [heartbeat, options.teamReport]) {
        if (transient === undefined) continue
        const job = {
          id: transient.id,
          cron: transient.cron,
          prompt: '',
          target: transient.target,
          createdAt: Date.now(),
        }
        await scheduler.add(job, { durable: false, prompt: transient.prompt })
      }
      await scheduler.start()
      options.write(
        `scheduler: ${String(options.store.list().length)} jobs, heartbeat ${heartbeat === undefined ? 'off' : 'on'}`,
      )
    },
    stop: () => {
      stopped = true
      return scheduler.stop()
    },
  }
}
