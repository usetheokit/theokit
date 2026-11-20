import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'

import { projectsRoot, scheduleSessionSweep } from '@theokit/agents/session'

/**
 * TheoCode's wiring of the framework's sweep scheduler (`scheduleSessionSweep`).
 *
 * The decision (enabled, due, first), the stamp and the bounded detached child are the framework's.
 * What stays here is what is TheoCode's: the command the child runs (`sessions gc --all-projects`,
 * the one delete path), the `[sessions gc]` wording, the first-run sentence that tells the operator
 * how to opt out, and the guard that keeps a malformed config from taking the terminal down.
 */

/** Beside the projects tree, never inside it (it holds no project, and the sweep lists directories). */
const stampPath = (root: string): string => join(dirname(root), '.last-session-gc')

export interface SweepCommand {
  readonly command: string
  readonly args: readonly string[]
}

/**
 * The argv for the child: the command that already exists, not a second delete path.
 *
 * Refuses an empty executable or a missing script: a child with no script exits 0 having swept
 * nothing, and the collector would report a finished sweep every day while collecting nothing.
 */
export function buildSweepCommand(input: {
  readonly apply: boolean
  readonly execPath: string
  readonly script: string | undefined
  readonly maxAgeDays?: number
}): SweepCommand {
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

/** What the operator reads when the child finishes. */
function sweepFinishedLine(firstRun: boolean, code: number | null, said: string): string {
  const exit = code === 0 || code === null ? '' : ` with exit ${String(code)}`
  // The child's verdict line — `DRY-RUN — …` or `APPLIED — N artifact(s) removed`.
  const summary = said
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('DRY-RUN') || l.startsWith('APPLIED'))
  const detail = summary === undefined ? '' : ` — ${summary}`
  if (!firstRun) return `[sessions gc] background sweep finished${exit}${detail}`
  return (
    `[sessions gc] first background sweep finished${exit}${detail} — DRY RUN by design. ` +
    'The next one will apply; set `session_gc = false` to keep collection manual.'
  )
}

export function startSessionSweepInBackground(opts: {
  readonly enabled: boolean
  readonly onReport: (line: string) => void
  readonly now?: Date
  readonly projectsRootOverride?: string
  readonly intervalHours?: number
  /** The retention window from `cleanupPeriodDays`, when the operator wrote one. */
  readonly maxAgeDays?: number
  /** Test seam for the child process. */
  readonly spawn?: typeof nodeSpawn
}): { readonly started: boolean; readonly reason: string } {
  const root = opts.projectsRootOverride ?? projectsRoot()
  let firstRun = false
  let finished = false
  let said = ''
  const spawnChild = ((command: string, args: readonly string[], options: object): ChildProcess => {
    const child = (opts.spawn ?? nodeSpawn)(command, [...args], options)
    child.stdout?.on('data', (chunk: unknown) => {
      said += String(chunk)
    })
    // Registered before the framework's own `close` handler, so `finished` is set when it reports.
    child.on('close', (code: number | null) => {
      finished = true
      opts.onReport(sweepFinishedLine(firstRun, code, said))
    })
    return child
  }) as typeof nodeSpawn

  const result = scheduleSessionSweep({
    enabled: opts.enabled,
    stampFile: stampPath(root),
    ...(opts.intervalHours === undefined ? {} : { intervalHours: opts.intervalHours }),
    ...(opts.now === undefined ? {} : { now: opts.now }),
    command: ({ apply }) => {
      firstRun = !apply
      return buildSweepCommand({
        apply,
        execPath: process.execPath,
        script: process.argv[1],
        ...(opts.maxAgeDays === undefined ? {} : { maxAgeDays: opts.maxAgeDays }),
      })
    },
    onReport: (line) => {
      // The framework's finish line is replaced by `sweepFinishedLine` above.
      if (!finished) opts.onReport(`[sessions gc] ${line}`)
    },
    spawn: spawnChild,
  })
  return { started: result.started, reason: result.reason }
}

/**
 * What to tell the operator when the sweep did NOT start, or `undefined` for the normal cases.
 * `too-soon` and `disabled` are intended states and are not worth a line on every launch.
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
 * `enabled` and `maxAgeDays` are FUNCTIONS: they come from `resolveEffectiveConfig`, which THROWS on a
 * malformed `~/.theocode/config.toml`, and reading them at the call site would evaluate them outside
 * this guard. Skipping is reported, never silent.
 */
export function guardedSweepStart(opts: {
  readonly enabled: () => boolean
  readonly onReport: (line: string) => void
  readonly start?: (o: {
    enabled: boolean
    onReport: (line: string) => void
    maxAgeDays?: number
  }) => { started: boolean; reason: string }
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
