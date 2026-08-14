/**
 * M83 — orderly shutdown, with a watchdog.
 *
 * ## Why the exit codes must stay distinguishable
 *
 * Three things end a terminal agent, and they are not the same event:
 *
 * | outcome | code | what an operator does |
 * |---|---|---|
 * | clean Ctrl-C | `130` | nothing — the user meant it |
 * | a cleanup threw | `1` | read the error; something did not release |
 * | the watchdog fired | `2` | a cleanup HUNG; find which one |
 *
 * Collapsing them into one code is what makes a hung cleanup indistinguishable from a user pressing
 * Ctrl-C — and the hang then reads as normal operation forever. `130` is the shell convention for
 * SIGINT (`128 + 2`), so a CI job that treats it as "user cancelled" keeps working.
 *
 * ## Why the deps are injected
 *
 * `signals`, `exit` and the timer come from outside. A shutdown module that calls `process.exit`
 * directly cannot be tested — the first assertion kills the test runner — so the version that ships
 * is the version nobody ran.
 */

/** One thing to release, in the order registered. */
export interface CleanupTask {
  /** Named so a watchdog timeout can say WHICH cleanup hung, rather than that one did. */
  readonly name: string
  readonly run: () => void | Promise<void>
}

/** How the process ended. */
export type ShutdownOutcome = 'clean' | 'cleanup-failed' | 'watchdog-timeout'

/** Exit codes, distinguishable on purpose. See the module docblock. */
export const SHUTDOWN_EXIT_CODES: Readonly<Record<ShutdownOutcome, number>> = {
  clean: 130,
  'cleanup-failed': 1,
  'watchdog-timeout': 2,
}

/** The watchdog budget. Three seconds is the consumer's measured default. */
export const DEFAULT_WATCHDOG_MS = 3_000

export interface ShutdownDeps {
  /** Registers a signal handler. Injected so the suite never installs one on the runner. */
  readonly onSignal?: (signal: 'SIGINT' | 'SIGTERM', handler: () => void) => void
  /** Ends the process. Injected for the same reason — a real `process.exit` kills the test. */
  readonly exit?: (code: number) => void
  /** Where a cleanup failure or a watchdog timeout is reported. */
  readonly onWarn?: (message: string) => void
  /** Watchdog budget in ms. */
  readonly watchdogMs?: number
}

export interface Shutdown {
  /** Register a cleanup. Runs in registration order. */
  register(task: CleanupTask): void
  /** Run every cleanup, then exit. Idempotent: a second Ctrl-C does not start a second teardown. */
  run(): Promise<ShutdownOutcome>
}

const IGNORE = (): void => undefined

/**
 * Build a shutdown.
 *
 * The watchdog races the whole cleanup sequence rather than each task: a budget per task lets N slow
 * tasks add up to N × budget, which is the shape that makes "it eventually exits" true and useless.
 */
export function createShutdown(deps: ShutdownDeps = {}): Shutdown {
  const tasks: CleanupTask[] = []
  const warn = deps.onWarn ?? IGNORE
  const exit = deps.exit ?? IGNORE
  const watchdogMs = deps.watchdogMs ?? DEFAULT_WATCHDOG_MS
  let running: Promise<ShutdownOutcome> | undefined

  const withWatchdog = async (): Promise<ShutdownOutcome> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const pending = new Set(tasks.map((t) => t.name))
    const watchdog = new Promise<ShutdownOutcome>((resolve) => {
      timer = setTimeout(() => {
        // Names the tasks still outstanding: "shutdown timed out" sends an operator hunting, while
        // "still waiting on: transcript-flush" sends them to the code.
        const outstanding = [...pending].join(', ') || '(none)'
        warn(
          `shutdown watchdog fired after ${String(watchdogMs)} ms; still waiting on: ${outstanding}`,
        )
        resolve('watchdog-timeout')
      }, watchdogMs)
    })

    const sequence = (async () => {
      let outcome: ShutdownOutcome = 'clean'
      for (const task of tasks) {
        try {
          await task.run()
        } catch (error) {
          outcome = 'cleanup-failed'
          warn(`cleanup "${task.name}" failed: ${(error as Error).message}`)
        }
        pending.delete(task.name)
      }
      return outcome
    })()

    try {
      return await Promise.race([sequence, watchdog])
    } finally {
      // A pending timer keeps the event loop alive — the process would hang AFTER deciding to exit,
      // which is the failure a watchdog exists to prevent, arriving by the watchdog's own hand.
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  const shutdown: Shutdown = {
    register(task) {
      tasks.push(task)
    },
    run() {
      // Idempotent: a second Ctrl-C while teardown is in flight must not start a second sequence
      // over the same resources — that is how a double-release turns a clean exit into a crash.
      running ??= withWatchdog().then((outcome) => {
        exit(SHUTDOWN_EXIT_CODES[outcome])
        return outcome
      })
      return running
    },
  }

  if (deps.onSignal !== undefined) {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      deps.onSignal(signal, () => void shutdown.run())
    }
  }
  return shutdown
}
