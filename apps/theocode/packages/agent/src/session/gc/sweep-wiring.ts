import type { spawn as nodeSpawn } from 'node:child_process'
import { dirname, join } from 'node:path'

import { projectsRoot, scheduleSessionSweep } from '@theokit/agents/session'

/**
 * TheoCode's wiring of the framework's `scheduleSessionSweep`: the decision (enabled, due, first run
 * is a dry run), the stamp, the bounded detached child and the closing report are the framework's.
 * What stays here is TheoCode's: the command the child runs (`sessions gc --all-projects`), the
 * wording the operator reads, and the guard that keeps a config error from taking the terminal down.
 */

export interface SweepCommandInput {
  /** Whether the child deletes. False on the first sweep — see B-139. */
  readonly apply: boolean
  /** `process.execPath` — the Node binary currently running. */
  readonly execPath: string
  /** `process.argv[1]` — whatever entry point started this process, bundle or `tsx` source. */
  readonly script: string | undefined
  /** #736 — the window from `cleanupPeriodDays`; absent leaves the child's default. */
  readonly maxAgeDays?: number
}

export interface SweepCommand {
  readonly command: string
  readonly args: readonly string[]
}

/**
 * The command the child runs: the one that already exists, so the delete path has one implementation.
 * Refusing to build is the safe direction: a child with no script exits 0 having swept nothing, and
 * the collector would report a finished sweep every day while collecting nothing.
 */
export function buildSweepCommand(input: SweepCommandInput): SweepCommand {
  if (input.execPath.trim() === '') {
    throw new Error('session gc: refusing to spawn a sweep with an empty executable')
  }
  if (input.script === undefined || input.script.trim() === '') {
    throw new Error('session gc: refusing to spawn a sweep with no script to run')
  }
  return {
    command: input.execPath,
    args: [
      input.script,
      'sessions',
      'gc',
      '--all-projects',
      ...(input.apply ? ['--apply'] : []),
      ...(input.maxAgeDays === undefined ? [] : ['--max-age-days', String(input.maxAgeDays)]),
    ],
  }
}

/** At most once a day; the retention window is measured in days. */
const DEFAULT_INTERVAL_HOURS = 24

/** Beside the projects tree rather than inside it, away from the one path that deletes user data. */
function stampPath(root: string): string {
  return join(dirname(root), '.last-session-gc')
}

/**
 * The framework reports the child's last stdout line (`DRY-RUN — …` / `APPLIED — N artifact(s)
 * removed`) behind a `(dry run) ` prefix on the first sweep. TheoCode's own sentence says so by
 * design and how to opt out; a later sweep says only that it finished.
 */
function reportLine(firstRun: boolean, framework: string): string {
  if (/^session sweep(:| failed)/.test(framework)) return `[sessions gc] ${framework}`
  const exit = /exit code (\d+)/.exec(framework)?.[1]
  const failed = exit !== undefined && exit !== '0' ? ` with exit ${exit}` : ''
  const said = framework.replace(/^\(dry run\) /, '')
  const detail = /^(DRY-RUN|APPLIED)/.test(said) ? ` — ${said}` : ''
  if (!firstRun) return `[sessions gc] background sweep finished${failed}${detail}`
  return (
    `[sessions gc] first background sweep finished${failed}${detail} — DRY RUN by design. ` +
    'The next one will apply; set `session_gc = false` to keep collection manual.'
  )
}

export function startSessionSweepInBackground(opts: {
  readonly enabled: boolean
  readonly onReport: (line: string) => void
  readonly now?: Date
  readonly projectsRootOverride?: string
  readonly intervalHours?: number
  /** #736 — the retention window from `cleanupPeriodDays`, when the operator wrote one. */
  readonly maxAgeDays?: number
  /** Test seam: the framework's `spawn` seam. */
  readonly spawn?: typeof nodeSpawn
}): { readonly started: boolean; readonly reason: string } {
  const root = opts.projectsRootOverride ?? projectsRoot()
  let firstRun = false
  let unspawnable = false
  const outcome = scheduleSessionSweep({
    enabled: opts.enabled,
    stampFile: stampPath(root),
    intervalHours: opts.intervalHours ?? DEFAULT_INTERVAL_HOURS,
    ...(opts.now === undefined ? {} : { now: opts.now }),
    ...(opts.spawn === undefined ? {} : { spawn: opts.spawn }),
    command: ({ apply }) => {
      firstRun = !apply
      try {
        return buildSweepCommand({
          apply,
          execPath: process.execPath,
          script: process.argv[1],
          ...(opts.maxAgeDays === undefined ? {} : { maxAgeDays: opts.maxAgeDays }),
        })
      } catch (err) {
        unspawnable = true
        throw err
      }
    },
    onReport: (line) => {
      opts.onReport(reportLine(firstRun, line))
    },
  })
  return unspawnable ? { started: false, reason: 'unspawnable' } : outcome
}

/**
 * What to tell the operator when the sweep did NOT start, or `undefined` for the normal cases
 * (`too-soon` and `disabled` would put a line in the log on nearly every launch).
 */
export function startupNoticeFor(outcome: {
  readonly started: boolean
  readonly reason: string
}): string | undefined {
  if (outcome.started) return undefined
  if (outcome.reason === 'too-soon' || outcome.reason === 'disabled') return undefined
  return `[sessions gc] not started: ${outcome.reason}`
}

/**
 * Start the background sweep so that nothing it touches can take the terminal down.
 *
 * `enabled` is a FUNCTION: its value comes from `resolveEffectiveConfig`, which throws on a malformed
 * config, and reading it at the call site would evaluate it outside this guard. Skipping is reported,
 * never silent.
 */
export function guardedSweepStart(opts: {
  /** Read INSIDE the guard — see above. */
  readonly enabled: () => boolean
  readonly onReport: (line: string) => void
  /** Injected in tests; production passes the real starter. */
  readonly start?: (o: {
    enabled: boolean
    onReport: (line: string) => void
    maxAgeDays?: number
  }) => { started: boolean; reason: string }
  /** #736 — the retention window, read INSIDE the guard for the same reason `enabled` is. */
  readonly maxAgeDays?: () => number | undefined
}): void {
  try {
    const start = opts.start ?? startSessionSweepInBackground
    const days = opts.maxAgeDays?.()
    const outcome = start({
      enabled: opts.enabled(),
      onReport: opts.onReport,
      ...(days === undefined ? {} : { maxAgeDays: days }),
    })
    const notice = startupNoticeFor(outcome)
    if (notice !== undefined) opts.onReport(notice)
  } catch (err) {
    opts.onReport(`[sessions gc] skipped — ${err instanceof Error ? err.message : String(err)}`)
  }
}
