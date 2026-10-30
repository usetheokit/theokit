import { CronExpressionParser } from 'cron-parser'

import { generateNewTraceContext } from '../observability/trace-context-propagation.js'

import type { CronLock } from './cron-lock.js'
import type { CronContext, CronDefinition } from './cron-types.js'

/**
 * In-process cron scheduler, run by `theokit start` (and by `theokit dev --crons`).
 *
 * Algorithm:
 *   - For each cron, compute `nextFireAt = cron-parser.next()`.
 *   - Schedule a `setTimeout(handler, nextFireAt - now)`.
 *   - After handler invocation (sync return or Promise scheduled), recompute
 *     next fire from CURRENT time (drift-free vs scheduled time).
 *
 * Per-cron isolation (EC-109):
 *   - Each cron's handler invocation is fire-and-forget (`void` scheduled).
 *     A hanging handler does NOT block the scheduler loop nor other crons.
 *   - `concurrency: 'forbid'` (default) tracks an in-flight flag per-cron;
 *     subsequent ticks skip + warn while the in-flight flag is set.
 *   - `concurrency: 'allow'` runs handlers concurrently — caller's responsibility.
 *
 * Several processes (replicas) each run this scheduler under `theokit start`. Without a `lock`,
 * each one fires every tick. With one, each tick asks the lock first and only the process that
 * gets `true` runs the handler (usetheokit/theokit#1016). A lock that fails skips the tick and logs
 * the error: running unguarded would repeat the side effect on every replica, which is the defect
 * the lock exists for.
 *
 * Serverless targets use platform-native triggers (T1.5 adapter translators), which fire once.
 */

export interface CronSchedulerOptions {
  /** Shared lock deciding which process runs each tick. Absent: this process runs every tick. */
  lock?: CronLock
}

export interface CronScheduler {
  start(): void
  stop(): void
}

interface CronJobState {
  readonly def: CronDefinition
  inFlight: boolean
  timer: NodeJS.Timeout | null
  abortController: AbortController | null
}

export function createCronScheduler(
  definitions: readonly CronDefinition[],
  options: CronSchedulerOptions = {},
): CronScheduler {
  const lock = options.lock
  const states: CronJobState[] = definitions.map((def) => ({
    def,
    inFlight: false,
    timer: null,
    abortController: null,
  }))

  let started = false

  /** Run the tick if the lock (when there is one) gives it to this process. */
  const fireIfLockAllows = (state: CronJobState, scheduledAt: Date): void => {
    if (lock === undefined) {
      fireAndReschedule(state, scheduledAt)
      return
    }
    state.timer = null
    void lock.acquire(state.def.name, scheduledAt).then(
      (won) => {
        if (won) fireAndReschedule(state, scheduledAt)
        else scheduleNext(state)
      },
      (err: unknown) => {
        console.error(
          `[theokit:cron] "${state.def.name}" skipped tick at ${scheduledAt.toISOString()}: ` +
            'the cron lock could not be acquired:',
          err instanceof Error ? err.message : err,
        )
        scheduleNext(state)
      },
    )
  }

  const fireAndReschedule = (state: CronJobState, scheduledAt: Date): void => {
    state.timer = null

    if (state.inFlight && state.def.concurrency === 'forbid') {
      console.warn(
        `[theokit:cron] "${state.def.name}" skipped tick at ${scheduledAt.toISOString()} ` +
          '— previous handler still running (concurrency: forbid).',
      )
      scheduleNext(state)
      return
    }

    state.inFlight = true
    state.abortController = new AbortController()
    const traceCtx = generateNewTraceContext()
    const ctx: CronContext = {
      traceId: traceCtx.trace_id,
      scheduledAt,
      signal: state.abortController.signal,
    }

    // Fire-and-forget: EC-109 — never await here so a hanging handler
    // can't block the scheduler loop or other crons.
    void Promise.resolve()
      .then(() => state.def.handler(ctx))
      .catch((err: unknown) => {
        console.error(
          `[theokit:cron] "${state.def.name}" handler error:`,
          err instanceof Error ? err.message : err,
        )
      })
      .finally(() => {
        state.inFlight = false
      })

    scheduleNext(state)
  }

  const scheduleNext = (state: CronJobState): void => {
    if (!started) return
    const interval = CronExpressionParser.parse(state.def.schedule, {
      tz: 'UTC',
      currentDate: new Date(),
    })
    const next = interval.next().toDate()
    const delayMs = Math.max(0, next.getTime() - Date.now())
    state.timer = setTimeout(() => {
      fireIfLockAllows(state, next)
    }, delayMs)
    // setTimeout returns a Timeout object; in Node, .unref() is available but
    // we DO want this to keep the event loop alive in dev — explicit no-unref.
  }

  return {
    start(): void {
      if (started) return
      started = true
      for (const state of states) {
        scheduleNext(state)
      }
    },
    stop(): void {
      started = false
      for (const state of states) {
        if (state.timer) {
          clearTimeout(state.timer)
          state.timer = null
        }
        state.abortController?.abort()
        state.abortController = null
      }
    },
  }
}
