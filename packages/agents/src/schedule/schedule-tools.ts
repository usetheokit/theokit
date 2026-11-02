// B-396 — the agent-facing side of the scheduler: the owner creates, lists and cancels jobs in a
// sentence, through these three tools. They go to the owner's agents only (plan D3); a scheduled run
// is never given them.
import { Tool, type CustomTool } from '@theokit/sdk'
import { z } from 'zod'

import type { Scheduler } from './scheduler.js'

/** How many durable jobs one store holds, unless the caller says otherwise. */
const DEFAULT_MAX_JOBS = 50

export interface CreateScheduleToolsOptions {
  scheduler: Scheduler
  /** The platforms a job may target: the ones the host has configured. */
  platforms: readonly string[]
  maxJobs?: number
}

const scheduleInput = z.object({
  cron: z
    .string()
    .min(1)
    .describe(
      'A 5-field cron expression (minute hour day month weekday) or @hourly, @daily, @weekly, @monthly, @yearly.',
    ),
  prompt: z
    .string()
    .min(1)
    .describe('What the scheduled run should do, stated so it can be done with nobody present.'),
  platform: z.string().min(1).describe('The chat platform the answer is sent to.'),
  channelId: z.string().min(1).describe('The channel, chat or conversation id on that platform.'),
  name: z.string().min(1).optional().describe('A short name for the job.'),
  timezone: z
    .string()
    .min(1)
    .optional()
    .describe('An IANA timezone such as Europe/Lisbon. Defaults to UTC.'),
})

const cancelInput = z.object({ id: z.string().min(1).describe('The id schedule_job returned.') })

/**
 * Build `schedule_job`, `list_scheduled_jobs` and `cancel_scheduled_job` over `scheduler`. Every
 * refusal (a platform outside `platforms`, a cron or timezone the SDK rejects, a full store) is
 * answered as `{ ok: false, error }` for the model to read, and stores nothing; a missing field is
 * refused by the input schema, which the SDK reports to the model as a tool error.
 */
export function createScheduleTools(options: CreateScheduleToolsOptions): CustomTool[] {
  const { scheduler, platforms } = options
  const maxJobs = options.maxJobs ?? DEFAULT_MAX_JOBS
  const listed = platforms.join(', ')

  const scheduleJob = Tool.create({
    name: 'schedule_job',
    description:
      'Schedule a prompt to run unattended on a cron schedule and send its answer to a chat. ' +
      `The platform is one of: ${listed}. ` +
      'Returns JSON: { ok: true, id, nextRunAt } or { ok: false, error }.',
    inputSchema: scheduleInput,
    handler: async (raw: unknown): Promise<string> => {
      // A missing or malformed field is refused by the SDK's own schema check before this runs.
      const input = scheduleInput.parse(raw)
      if (!platforms.includes(input.platform)) {
        return refuse(
          `platform ${JSON.stringify(input.platform)} is not configured; use one of: ${listed}`,
        )
      }
      if (scheduler.list().length >= maxJobs)
        return refuse(`the schedule already holds ${String(maxJobs)} jobs`)
      const id = `job-${crypto.randomUUID().slice(0, 8)}`
      try {
        const { nextRunAt } = await scheduler.add({
          id,
          cron: input.cron,
          prompt: input.prompt,
          target: { platform: input.platform, channelId: input.channelId },
          createdAt: Date.now(),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
        })
        return JSON.stringify({ ok: true, id, nextRunAt })
      } catch (error) {
        return refuse(error instanceof Error ? error.message : String(error))
      }
    },
  })

  const listJobs = Tool.create({
    name: 'list_scheduled_jobs',
    description:
      'List the scheduled jobs. Returns JSON: { jobs: [{ id, name, cron, target: { platform, channelId } }] }.',
    inputSchema: z.object({}),
    handler: (): Promise<string> =>
      Promise.resolve(
        JSON.stringify({
          jobs: scheduler.list().map(({ id, name, cron, target }) => ({ id, name, cron, target })),
        }),
      ),
  })

  const cancelJob = Tool.create({
    name: 'cancel_scheduled_job',
    description:
      'Cancel a scheduled job by id. Returns JSON: { ok: true } or { ok: false, error }.',
    inputSchema: cancelInput,
    handler: async (raw: unknown): Promise<string> => {
      const { id } = cancelInput.parse(raw)
      // Only a stored job: a transient one the host added (the heartbeat) is not the owner's to cancel.
      if (!scheduler.list().some((job) => job.id === id)) return refuse('no such job')
      return (await scheduler.cancel(id)) ? JSON.stringify({ ok: true }) : refuse('no such job')
    },
  })

  return [scheduleJob, listJobs, cancelJob]
}

function refuse(error: string): string {
  return JSON.stringify({ ok: false, error })
}
