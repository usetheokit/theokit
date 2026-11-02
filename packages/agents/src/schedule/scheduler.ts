// B-396 — the scheduler: the SDK `Cron` is the timer, and each fire reaches our code through its
// public `workflow` target (plan D1). The SDK's own fire handler drops the run's text, so the prompt,
// the delivery, the suppression and the previous output are all decided here.
import { Cron } from '@theokit/sdk'
import { fn, Workflow } from '@theokit/sdk/workflow'

import type { JobStore, ScheduledJob, ScheduleTarget } from './job-store.js'
import {
  buildScheduledPrompt,
  PREVIOUS_OUTPUT_LIMIT,
  readScheduledAnswer,
} from './scheduled-prompt.js'

/** What one run of a scheduled prompt produced. */
export type RunResult = { ok: true; text: string } | { ok: false; error: string }

/** Runs one prompt on an agent. `signal` is aborted when the scheduler stops. */
export type RunPort = (prompt: string, signal: AbortSignal) => Promise<RunResult>

/** What a delivery attempt reports. `error.code` names why nothing was sent. */
export interface DeliveryResult {
  ok: boolean
  error?: { code: string }
}

/** Sends one text to one target. */
export type DeliverPort = (target: ScheduleTarget, text: string) => Promise<DeliveryResult>

/** How one fire ended. */
export type FireOutcome =
  | 'delivered'
  | 'suppressed'
  | 'failed'
  | 'skipped'
  | 'empty'
  | 'undelivered'
  | 'cancelled'

/** A job kept out of the store, whose prompt is read on each fire (`undefined` or blank: no run). */
export interface TransientJobOptions {
  durable: false
  prompt: () => Promise<string | undefined>
}

export interface CreateSchedulerOptions {
  store: JobStore
  run: RunPort
  deliver: DeliverPort
  /** Where an undelivered answer is reported. Defaults to stderr. */
  write?: (line: string) => void
}

export interface Scheduler {
  /**
   * Register every stored job with the SDK `Cron` and start its timer. A job the SDK refuses is
   * reported through `write` and skipped; after `stop()` this does nothing.
   */
  start(): Promise<void>
  /** Abort in-flight runs, wait for them, and remove every SDK job this scheduler registered. */
  stop(): Promise<void>
  /** Register `job` with the SDK `Cron` (a rejected cron throws, nothing stored), then store it. */
  add(job: ScheduledJob, transient?: TransientJobOptions): Promise<{ nextRunAt?: number }>
  /** Resolves `true` when a durable job was held and is now gone. */
  cancel(id: string): Promise<boolean>
  /** The durable jobs. */
  list(): ScheduledJob[]
  /** Run one fire of `id` now. Never rejects. */
  fire(id: string): Promise<FireOutcome>
  /** How many fires of `id` were skipped because its previous fire was still running. */
  skipped(id: string): number
}

interface TransientJob {
  job: ScheduledJob
  prompt: () => Promise<string | undefined>
  previousOutput?: string
}

/**
 * Build a scheduler over `store`. `run` and `deliver` are the caller's ports (plan D1). Its timers
 * are the SDK `Cron`, which is process-global: `stop()` deletes this scheduler's own SDK jobs and
 * stops the SDK timer only when no other SDK job is left in the process.
 */
export function createScheduler(options: CreateSchedulerOptions): Scheduler {
  const { store, run, deliver } = options
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`))
  const sdkIds = new Map<string, string>()
  const transients = new Map<string, TransientJob>()
  const inFlight = new Map<string, { controller: AbortController; done: Promise<FireOutcome> }>()
  const skips = new Map<string, number>()
  let stopped = false

  const register = async (job: ScheduledJob): Promise<{ nextRunAt?: number }> => {
    const workflow = Workflow.create({ name: `scheduled-${job.id}` })
      .then(
        fn('fire', () => {
          // Not awaited: an overlapping tick must reach `fire` to be counted as skipped, and the
          // workflow's own single-flight lock would otherwise refuse it before our code sees it.
          void fire(job.id)
          return 'started'
        }),
      )
      .commit()
    const created = await Cron.create({
      cron: job.cron,
      ...(job.timezone === undefined ? {} : { timezone: job.timezone }),
      name: job.id,
      workflow,
    })
    sdkIds.set(job.id, created.id)
    return created.nextRunAt === undefined ? {} : { nextRunAt: created.nextRunAt }
  }

  const unregister = async (id: string): Promise<void> => {
    const sdkId = sdkIds.get(id)
    if (sdkId === undefined) return
    // The mapping goes only once the SDK job is gone: a delete that throws leaves the job with its
    // timer handle, so a later cancel can still remove it (review finding #83).
    await Cron.delete(sdkId)
    sdkIds.delete(id)
  }

  const send = (job: ScheduledJob, text: string): Promise<boolean> =>
    sendOrReport(deliver, write, job, text)

  /** A stop, or a cancel of this job while it ran, wins: nothing is stored or sent after it (EC-1, EC-2). */
  const cancelledDuring = (id: string, signal: AbortSignal): boolean =>
    signal.aborted || stopped || (!transients.has(id) && store.get(id) === undefined)

  const runOnce = async (id: string, signal: AbortSignal): Promise<FireOutcome> => {
    const built = await promptOf(store, transients, id)
    if (built === undefined) return 'empty'
    const { job, prompt } = built
    const result = await runCaught(run, prompt, signal)
    if (cancelledDuring(id, signal)) return 'cancelled'
    if (!result.ok) {
      await send(job, `Scheduled job ${job.name ?? job.id} failed: ${result.error}`)
      return 'failed'
    }
    if (!(await remember(store, transients, id, result.text))) return 'cancelled'
    const answer = readScheduledAnswer(result.text)
    if (answer.kind === 'silent') return 'suppressed'
    return (await send(job, answer.text)) ? 'delivered' : 'undelivered'
  }

  const fire = (id: string): Promise<FireOutcome> => {
    if (stopped) return Promise.resolve('cancelled')
    if (inFlight.has(id)) {
      const count = (skips.get(id) ?? 0) + 1
      skips.set(id, count)
      write(
        `scheduler: job ${jobName(store, transients, id)}: fire skipped, the previous fire still runs (${String(count)} skipped)`,
      )
      return Promise.resolve('skipped')
    }
    const controller = new AbortController()
    const done = runOnce(id, controller.signal)
      .catch((error: unknown) => {
        write(`scheduler: job ${id}: ${error instanceof Error ? error.message : String(error)}`)
        return 'failed' as const
      })
      .finally(() => inFlight.delete(id))
    inFlight.set(id, { controller, done })
    return done
  }

  return {
    async start() {
      // A start that arrives after `stop()` (a shutdown during the host's start) registers nothing.
      if (stopped) return
      for (const job of store.list()) {
        if (sdkIds.has(job.id)) continue
        // One job the SDK refuses (a hand-edited cron) is reported and skipped; the others still run.
        await register(job).catch((error: unknown) => {
          write(
            `scheduler: job ${job.name ?? job.id}: ${error instanceof Error ? error.message : String(error)}`,
          )
        })
      }
      await Cron.start()
    },
    async stop() {
      stopped = true
      const running = [...inFlight.values()]
      for (const entry of running) entry.controller.abort()
      await Promise.all(running.map((entry) => entry.done))
      for (const id of [...sdkIds.keys()]) await unregister(id)
      transients.clear()
      // `Cron.stop()` is process-global: it clears every SDK timer, another scheduler's or the
      // consumer's own. Stop it only when no SDK job is left once this scheduler's are deleted.
      if ((await Cron.status()).jobCount === 0) await Cron.stop()
    },
    async add(job, transient) {
      const next = await register(job)
      if (transient !== undefined) {
        transients.set(job.id, { job, prompt: transient.prompt })
        return next
      }
      try {
        await store.put(job)
      } catch (error) {
        await unregister(job.id)
        throw error
      }
      return next
    },
    async cancel(id) {
      await unregister(id)
      if (transients.delete(id)) return true
      return store.remove(id)
    },
    list: () => store.list(),
    fire,
    skipped: (id) => skips.get(id) ?? 0,
  }
}

async function sendOrReport(
  deliver: DeliverPort,
  write: (line: string) => void,
  job: ScheduledJob,
  text: string,
): Promise<boolean> {
  let result: DeliveryResult
  try {
    result = await deliver(job.target, text)
  } catch {
    result = { ok: false, error: { code: 'deliver_threw' } }
  }
  if (!result.ok) {
    write(
      `scheduler: job ${job.name ?? job.id}: ${job.target.platform}: ${result.error?.code ?? 'unknown'}`,
    )
  }
  return result.ok
}

function jobName(
  store: JobStore,
  transients: ReadonlyMap<string, TransientJob>,
  id: string,
): string {
  return (transients.get(id)?.job ?? store.get(id))?.name ?? id
}

async function promptOf(
  store: JobStore,
  transients: ReadonlyMap<string, TransientJob>,
  id: string,
): Promise<{ job: ScheduledJob; prompt: string } | undefined> {
  const transient = transients.get(id)
  if (transient !== undefined) {
    const task = (await transient.prompt())?.trim()
    if (task === undefined || task === '') return undefined
    return { job: transient.job, prompt: buildScheduledPrompt(task, transient.previousOutput) }
  }
  const job = store.get(id)
  if (job === undefined) return undefined
  return { job, prompt: buildScheduledPrompt(job.prompt, job.previousOutput) }
}

async function remember(
  store: JobStore,
  transients: ReadonlyMap<string, TransientJob>,
  id: string,
  text: string,
): Promise<boolean> {
  const transient = transients.get(id)
  // Only the tail is ever read back (`buildScheduledPrompt`), so only the tail is kept.
  const tail = text.slice(-PREVIOUS_OUTPUT_LIMIT)
  if (transient !== undefined) {
    transient.previousOutput = tail
    return true
  }
  return store.setPreviousOutput(id, tail)
}

/** Run the prompt; a run that throws is reported as a failed result, like one that ends `error`. */
async function runCaught(run: RunPort, prompt: string, signal: AbortSignal): Promise<RunResult> {
  try {
    return await run(prompt, signal)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
