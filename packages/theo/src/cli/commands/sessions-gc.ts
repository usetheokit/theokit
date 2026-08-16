import { planTranscriptGC, runTranscriptGC } from '@theokit/agents/session'
import type { TranscriptGCPlan } from '@theokit/agents/session'

/**
 * M72 — `theokit agent sessions gc`: bound the disk state the framework creates.
 *
 * ## Why the default is a dry run
 *
 * This deletes conversation history. Without `--apply` the command PRINTS the plan and changes
 * nothing, because a destructive retention policy an operator has never seen the output of is a
 * policy nobody reviewed. Making `--apply` the default would save one flag and cost the review.
 *
 * The plan is printed in both modes, not just the dry one: an operator applying a policy still needs
 * to see what it decided, and "removed 12 sessions" without which ones is a report nobody can act
 * on.
 */

/**
 * Not exported: its only consumer is the signature below, in this same file.
 *
 * Publishing it would put a name in the package surface that nobody imports — the G7 shape knip
 * caught in M76. When a caller needs to hold these options in a typed variable, exporting it then is
 * one line; exporting it now is a promise to keep a name stable for an audience that does not exist.
 */
interface SessionsGcOptions {
  /** Actually delete. Absent ⇒ dry run. */
  readonly apply?: boolean
  /** Newest N sessions always survive (floor 1). */
  readonly keepLast?: number
  /** Only sessions older than this may go (floor 1). */
  readonly maxAgeDays?: number
  /** Where to collect. Defaults to the process cwd — the project the operator is standing in. */
  readonly cwd?: string
}

/** Defaults chosen to be boring: a month of history, never fewer than ten sessions. */
const DEFAULTS = { keepLast: 10, maxAgeDays: 30 } as const

/** Render the plan for a human. Returns lines so the command is testable without capturing stdout. */
export function formatGcPlan(
  plan: TranscriptGCPlan,
  // `Awaited<>` because `runTranscriptGC` is async (T2.2). Without it the parameter type IS the
  // Promise, and every field read below type-checks against a thenable that has none of them.
  result: Awaited<ReturnType<typeof runTranscriptGC>>,
): string[] {
  const lines: string[] = [result.dryRun ? '  Dry run — nothing was deleted.' : '  Applied.', '']

  if (result.removed.length === 0) {
    lines.push('  Nothing to collect.')
  } else {
    lines.push(`  ${result.dryRun ? 'Would remove' : 'Removed'} ${String(result.removed.length)}:`)
    for (const id of result.removed) lines.push(`    - ${id}`)
  }

  // The kept list carries the REASON per session. "Skipped 4" tells an operator nothing; "kept
  // because it holds an active writer lease" tells them whether to go stop something.
  if (plan.kept.length > 0) {
    lines.push('', `  Kept ${String(plan.kept.length)}:`)
    for (const keep of plan.kept) lines.push(`    - ${keep.id} — ${keep.reason}`)
  }

  if (result.errors.length > 0) {
    lines.push('', `  ${String(result.errors.length)} failed (the rest still ran):`)
    for (const error of result.errors) lines.push(`    ✗ ${error.id} — ${error.message}`)
  }

  return lines
}

/**
 * Plan and (optionally) apply transcript retention for one project.
 *
 * Returns the result so a caller can decide the exit code: a partial failure is reported, never
 * swallowed into a zero exit.
 */
export async function sessionsGcCommand(options: SessionsGcOptions = {}): Promise<{
  readonly lines: readonly string[]
  readonly failed: number
}> {
  const plan = planTranscriptGC({
    cwd: options.cwd ?? process.cwd(),
    keepLast: options.keepLast ?? DEFAULTS.keepLast,
    maxAgeDays: options.maxAgeDays ?? DEFAULTS.maxAgeDays,
  })
  // AWAITED. T2.2 made this async and this caller was not updated; `result.removed` was then
  // `undefined` on a Promise and the command threw before printing anything. The workspace
  // typecheck missed it because `packages/agents/dist/session.d.ts` was a day older than the source
  // and still declared the synchronous return.
  const result = await runTranscriptGC(plan, { apply: options.apply === true })
  return { lines: formatGcPlan(plan, result), failed: result.errors.length }
}
