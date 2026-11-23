import { planTranscriptGC, runTranscriptGC } from '../session/index.js'
import type { RunTranscriptGCResult, TranscriptGCPlan } from '../session/index.js'

/**
 * `sessions gc`: bound the disk state the framework creates.
 *
 * ## Why the default is a dry run
 *
 * This deletes conversation history. Without `--apply` the command PRINTS the plan and changes
 * nothing, because a destructive retention policy an operator has never seen the output of is a
 * policy nobody reviewed. An app whose daemon already sweeps (TheoClaw) may pass `defaultApply`.
 *
 * The plan is printed in both modes: "removed 12 sessions" without which ones is a report nobody
 * can act on.
 */

export interface SessionsGcOptions {
  /** Actually delete. Absent ⇒ dry run. */
  readonly apply?: boolean
  /** Newest N sessions always survive (floor 1). */
  readonly keepLast?: number
  /** Only sessions older than this may go (floor 1). */
  readonly maxAgeDays?: number
  /** Where to collect. Defaults to the process cwd. */
  readonly cwd?: string
  /** Print the machine report (one JSON line) instead of the human lines. */
  readonly json?: boolean
  /** Replace the human report (an app with its own wording). */
  /**
   * Replace the planner and runner, for an app that protects more than the framework does (a
   * registry, generations). Receives the resolved options; must return the plan and its result.
   */
  readonly human?: (plan: TranscriptGCPlan, result: RunTranscriptGCResult) => readonly string[]
  readonly run?: (resolved: {
    readonly apply: boolean
    readonly keepLast: number
    readonly maxAgeDays: number
    readonly cwd: string
  }) => Promise<{ plan: TranscriptGCPlan; result: RunTranscriptGCResult }>
}

export interface SessionsGcOutcome {
  readonly lines: readonly string[]
  readonly failed: number
}

/** The parsed flags of `sessions gc`, or the message to show for a bad one. */
export type SessionsGcArgs =
  | {
      readonly ok: true
      readonly apply: boolean
      readonly json: boolean
      readonly keepLast?: number
      readonly maxAgeDays?: number
    }
  | { readonly ok: false; readonly message: string }

/** Defaults chosen to be boring: a month of history, never fewer than ten sessions. */
const DEFAULTS = { keepLast: 10, maxAgeDays: 30 } as const

/**
 * Parse `--apply`, `--dry-run`, `--json`, `--keep-last <n>` and `--max-age-days <n>` (also
 * `--days` for the latter). `--apply` and `--dry-run` together are refused.
 */
export function parseSessionsGcArgs(
  args: readonly string[],
  defaults: { readonly apply?: boolean } = {},
): SessionsGcArgs {
  let apply = defaults.apply === true
  let sawApply = false
  let sawDry = false
  let json = false
  let keepLast: number | undefined
  let maxAgeDays: number | undefined
  const number = (flag: string, value: string | undefined): { n: number } | { message: string } => {
    if (value !== undefined && /^\d+$/.test(value) && Number(value) >= 1)
      return { n: Number(value) }
    const got = value === undefined ? '' : `, got "${value}"`
    return { message: `${flag} requires a positive integer${got}` }
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--apply') [apply, sawApply] = [true, true]
    else if (arg === '--dry-run') [apply, sawDry] = [false, true]
    else if (arg === '--json') json = true
    else if (arg === '--keep-last' || arg === '--max-age-days' || arg === '--days') {
      const parsed = number(arg, args[++i])
      if ('message' in parsed) return { ok: false, message: parsed.message }
      if (arg === '--keep-last') keepLast = parsed.n
      else maxAgeDays = parsed.n
    } else return { ok: false, message: `unknown argument "${arg}"` }
  }
  if (sawApply && sawDry) return { ok: false, message: '--apply and --dry-run cannot be combined' }
  return {
    ok: true,
    apply,
    json,
    ...(keepLast !== undefined ? { keepLast } : {}),
    ...(maxAgeDays !== undefined ? { maxAgeDays } : {}),
  }
}

/** Render the plan for a human. Returns lines so the command is testable without capturing stdout. */
export function formatGcPlan(plan: TranscriptGCPlan, result: RunTranscriptGCResult): string[] {
  const lines: string[] = [result.dryRun ? '  Dry run — nothing was deleted.' : '  Applied.', '']

  const verb = result.dryRun ? 'Would remove' : 'Removed'
  if (result.removed.length === 0 && result.orphaned.length === 0) {
    lines.push('  Nothing to collect.')
  }
  if (result.removed.length > 0) {
    lines.push(`  ${verb} ${String(result.removed.length)}:`)
    for (const id of result.removed) lines.push(`    - ${id}`)
  }
  // Reported separately and by PATH: these have no session id to print — the transcript could not
  // be read. Folding them into the count above would claim sessions were collected while naming
  // fewer, and a filename in the id column would put back the fabricated identity #668 removed.
  if (result.orphaned.length > 0) {
    lines.push(`  ${verb} ${String(result.orphaned.length)} with no readable session id:`)
    for (const path of result.orphaned) lines.push(`    - ${path}`)
  }

  // The kept list carries the REASON per session: it tells an operator whether to go stop something.
  if (plan.kept.length > 0) {
    lines.push('', `  Kept ${String(plan.kept.length)}:`)
    for (const keep of plan.kept)
      lines.push(`    - ${keep.id ?? '(id unreadable)'} — ${keep.reason}`)
  }

  if (result.errors.length > 0) {
    lines.push('', `  ${String(result.errors.length)} failed (the rest still ran):`)
    for (const error of result.errors)
      lines.push(`    ✗ ${error.id ?? '(id unreadable)'} — ${error.message}`)
  }

  return lines
}

/** The machine report: one JSON line. */
export function formatGcJson(plan: TranscriptGCPlan, result: RunTranscriptGCResult): string {
  return JSON.stringify({
    type: 'sessions.gc',
    dryRun: result.dryRun,
    removed: [...result.removed, ...result.orphaned],
    kept: plan.kept.length,
    keptReasons: plan.kept,
    errors: result.errors.map((e) => `${e.id ?? 'unnamed transcript'}: ${e.message}`),
  })
}

/**
 * Plan and (optionally) apply transcript retention for one project.
 *
 * Returns the report lines and the failure count so a caller decides the exit code: a partial
 * failure is reported, never swallowed into a zero exit.
 */
export async function sessionsGcCommand(
  options: SessionsGcOptions = {},
): Promise<SessionsGcOutcome> {
  const resolved = {
    apply: options.apply === true,
    keepLast: options.keepLast ?? DEFAULTS.keepLast,
    maxAgeDays: options.maxAgeDays ?? DEFAULTS.maxAgeDays,
    cwd: options.cwd ?? process.cwd(),
  }
  const { plan, result } =
    options.run !== undefined
      ? await options.run(resolved)
      : await (async () => {
          const planned = await planTranscriptGC({
            cwd: resolved.cwd,
            keepLast: resolved.keepLast,
            maxAgeDays: resolved.maxAgeDays,
          })
          // AWAITED: `runTranscriptGC` is async; reading `.removed` off the Promise threw.
          return {
            plan: planned,
            result: await runTranscriptGC(planned, { apply: resolved.apply }),
          }
        })()
  return {
    lines:
      options.json === true
        ? [formatGcJson(plan, result)]
        : (options.human ?? formatGcPlan)(plan, result),
    failed: result.errors.length,
  }
}
