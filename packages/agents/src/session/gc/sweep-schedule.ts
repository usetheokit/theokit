import { spawn as nodeSpawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Schedules the cross-project session GC: decides from a stamp file whether the interval has passed,
 * stamps BEFORE spawning (so two starts do not both sweep), and runs the app's own command in a
 * detached child with a time limit. The first run is a dry run. The command is the app's, not ours.
 */

export type SweepDecision =
  | { readonly run: false; readonly reason: 'disabled' | 'too-soon'; readonly lastRun?: Date }
  | { readonly run: true; readonly firstRun: boolean }

export function sweepDecision(input: {
  enabled: boolean
  now: Date
  intervalHours: number
  lastRun: Date | undefined
}): SweepDecision {
  if (!input.enabled) return { run: false, reason: 'disabled' }
  const last = input.lastRun
  if (last === undefined || Number.isNaN(last.getTime())) return { run: true, firstRun: true }
  const elapsedMs = input.now.getTime() - last.getTime()
  if (elapsedMs < input.intervalHours * 3_600_000) {
    return { run: false, reason: 'too-soon', lastRun: last }
  }
  return { run: true, firstRun: false }
}

export interface ScheduleSessionSweepOptions {
  readonly enabled: boolean
  /** e.g. `join(dirname(projectsRoot()), '.last-session-gc')` */
  readonly stampFile: string
  /** Default 24. */
  readonly intervalHours?: number
  /** argv for the child; receives apply=false on the first run. */
  readonly command: (input: { apply: boolean }) => { command: string; args: readonly string[] }
  /** Default 600_000. */
  readonly timeoutMs?: number
  readonly onReport: (line: string) => void
  readonly now?: Date
  /** Test seam. */
  readonly spawn?: typeof nodeSpawn
}

export interface SweepScheduleResult {
  readonly started: boolean
  readonly reason: 'disabled' | 'too-soon' | 'first-run-dry' | 'applying' | 'spawn-failed'
}

const DEFAULT_INTERVAL_HOURS = 24
const DEFAULT_TIMEOUT_MS = 600_000

function readStamp(file: string): Date | undefined {
  try {
    return new Date(readFileSync(file, 'utf8').trim())
  } catch {
    return undefined
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Never throws. A failure is reported through `onReport`. */
export function scheduleSessionSweep(options: ScheduleSessionSweepOptions): SweepScheduleResult {
  const report = (line: string): void => {
    try {
      options.onReport(line)
    } catch {
      // a reporter must not break startup
    }
  }
  try {
    const now = options.now ?? new Date()
    const decision = sweepDecision({
      enabled: options.enabled,
      now,
      intervalHours: options.intervalHours ?? DEFAULT_INTERVAL_HOURS,
      lastRun: readStamp(options.stampFile),
    })
    if (!decision.run) return { started: false, reason: decision.reason }

    const apply = !decision.firstRun
    const { command, args } = options.command({ apply })
    if (command === '') throw new Error('sweep command is empty')

    try {
      mkdirSync(dirname(options.stampFile), { recursive: true })
      writeFileSync(options.stampFile, now.toISOString())
    } catch (error) {
      report(`session sweep: could not write the stamp file (${message(error)})`)
    }

    const child = (options.spawn ?? nodeSpawn)(command, [...args], {
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      killSignal: 'SIGTERM',
    })
    let out = ''
    let done = false
    const finish = (line: string): void => {
      if (done) return
      done = true
      report(line)
    }
    child.stdout.on('data', (chunk: Buffer | string) => {
      out += String(chunk)
    })
    child.on('error', (error: Error) => {
      finish(`session sweep failed: ${error.message}`)
    })
    child.on('close', (code: number | null) => {
      const lines = out.split('\n').filter((l) => l.trim() !== '')
      const last = lines.at(-1)
      const prefix = apply ? '' : '(dry run) '
      finish(
        last === undefined
          ? `session sweep ${prefix}finished with exit code ${String(code)}`
          : `${prefix}${last}`,
      )
    })
    child.unref()
    ;(child.stdout as { unref?: () => void }).unref?.()
    return { started: true, reason: apply ? 'applying' : 'first-run-dry' }
  } catch (error) {
    report(`session sweep failed to start: ${message(error)}`)
    return { started: false, reason: 'spawn-failed' }
  }
}

export interface InProcessSweeper {
  /** Stops future runs and resolves once a run in flight has settled. */
  stop(): Promise<void>
}

/**
 * Runs `run` now and then every `intervalMs` inside this process. A tick that arrives while a run is
 * still going is skipped. The timer is unreferenced, so it never keeps the process alive. `run` is
 * the caller's: a rejection or throw is swallowed here, so report inside it.
 */
export function startInProcessSweeper(
  intervalMs: number,
  run: () => void | Promise<void>,
): InProcessSweeper {
  let running: Promise<void> = Promise.resolve()
  let busy = false
  let stopped = false
  const tick = (): void => {
    if (busy || stopped) return
    busy = true
    running = (async () => {
      try {
        await run()
      } catch {
        // the caller reports its own failures
      } finally {
        busy = false
      }
    })()
  }
  tick()
  const timer = setInterval(tick, intervalMs)
  timer.unref()
  return {
    stop: async () => {
      stopped = true
      clearInterval(timer)
      await running
    },
  }
}
