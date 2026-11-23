// B-396 — where the framework's scheduler meets the product: the store under the workspace, a run
// port over a read-only worker agent, and a delivery port over the adapters the channel loop has
// connected. The scheduler's deliver port is the framework's `gatewayDeliverPort`.
import { join } from 'node:path'

import {
  agentRunPort,
  createJobStore,
  createScheduler,
  createScheduleTools,
  type DeliverPort,
  type JobStore,
  type RunPort,
  type Scheduler,
} from '@theokit/agents/tools'
import { gatewayDeliverPort } from '@theokit/gateway-agent'
import type { CustomTool } from '@theokit/sdk'

import { createContainer } from '../agent-container.js'
import type { TurnAgent } from '../agent-port.js'
import { type ChannelLoop, maskSecrets } from '../channels/channel-loop.js'
import { type AgentToolOptions, workerToolOptions } from '../tools/tool-registry.js'
import type { ToolSettings } from '../tools/tool-settings.js'
import { createInboxTool, INBOX_PLATFORM, inboxFile, ScheduleInbox } from './schedule-inbox.js'

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
/**
 * The slice of the SDK handle `agentRunPort` uses, over a worker agent. The turn has no `stream`, so
 * the port only waits for it, as the run port here always did. `dispose` is a no-op: the container's
 * `withAgent` owns the agent's lifetime and disposes it when the run settles.
 */
function handleOf(agent: TurnAgent): Parameters<Parameters<typeof agentRunPort>[0]>[0] extends (a: infer H) => unknown ? H : never {
  return {
    agentId: 'theoclaw-scheduled-run',
    send: async (message, options) => {
      if (typeof message !== 'string') throw new Error('a scheduled run sends its prompt as text')
      const run = await agent.send(message, options)
      return {
        wait: async () => {
          const outcome = await run.wait()
          return {
            status: outcome.status,
            ...(outcome.result === undefined ? {} : { result: outcome.result }),
            ...(outcome.error === undefined
              ? {}
              : { error: { message: outcome.error.code ?? 'unknown', ...outcome.error } }),
          }
        },
      }
    },
    dispose: () => Promise.resolve(),
  }
}

function createRunPort(buildRunAgent: BuildRunAgent, tools: ToolSettings): RunPort {
  const { withAgent } = createContainer<TurnAgent>({
    factory: () => buildRunAgent(runAgentToolOptions(tools)),
  })
  return agentRunPort((work) => withAgent((agent) => work(handleOf(agent))))
}

/**
 * Deliver through the framework's `gatewayDeliverPort`, which reads the adapters connected by the
 * time of each send, so a platform that connects after the start is reached. The text is masked
 * first, as a chat reply and a broadcast answer are (OC-90). The local inbox is TheoClaw's own.
 */
function createDeliverPort(
  loop: Pick<ChannelLoop, 'started'>,
  secrets: readonly string[] = [],
  inbox?: ScheduleInbox,
): DeliverPort {
  const gateway = gatewayDeliverPort(() => [...loop.started.values()].map(({ adapter }) => adapter), { secrets })
  return async (target, text) => {
    if (target.platform === INBOX_PLATFORM && inbox !== undefined) {
      return (await inbox.add(target.channelId, text))
        ? { ok: true }
        : { ok: false, error: { code: 'inbox_write_failed' } }
    }
    return gateway(target, text)
  }
}

const INBOX_GUIDANCE =
  `The platform "${INBOX_PLATFORM}" is local, not a chat: the answer is stored in the instance and read back with read_schedule_inbox, ` +
  'so a user with no chat platform (web only) can use it. For it, channelId is just a free label you choose (for example "main"): do not ask the user for an id.'

/** Tell the model what the inbox target is: the framework's own text only knows chat platforms. */
function withInboxGuidance(tool: CustomTool): CustomTool {
  if (tool.name !== 'schedule_job') return tool
  const schema = tool.inputSchema as { properties?: Record<string, Record<string, unknown>> }
  const channel = schema.properties?.channelId
  return {
    ...tool,
    description: `${tool.description} ${INBOX_GUIDANCE}`,
    inputSchema: {
      ...schema,
      properties: {
        ...schema.properties,
        ...(channel === undefined
          ? {}
          : {
              channelId: {
                ...channel,
                description: `${String(channel.description)} For platform "${INBOX_PLATFORM}", any label such as "main".`,
              },
            }),
      },
    },
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
  /** The workspace: with it a job may also target the local `inbox` platform, so no chat platform is needed. */
  readonly workspace?: string
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
  const secrets = options.secrets ?? []
  const inbox =
    options.workspace === undefined
      ? undefined
      : new ScheduleInbox(inboxFile(options.workspace), (text) => maskSecrets(text, secrets))
  const scheduler = createScheduler({
    store: options.store,
    run: createRunPort(options.buildRunAgent, options.tools),
    deliver: createDeliverPort(options.loop, secrets, inbox),
    write: options.write,
  })
  const { heartbeat } = options
  let stopped = false
  return {
    scheduler,
    scheduleTools: [
      ...createScheduleTools({
        scheduler,
        platforms: inbox === undefined ? options.platforms : [...options.platforms, INBOX_PLATFORM],
      }).map((tool) => (inbox === undefined ? tool : withInboxGuidance(tool))),
      ...(inbox === undefined ? [] : [createInboxTool(inbox)]),
    ],
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
