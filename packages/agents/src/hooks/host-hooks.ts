import type { HookEvent, HookSpec } from './hook-events.js'
import type { HookIdentity } from './hook-fingerprint.js'
import { runHookCommand, type HookRunResult } from './hook-runner.js'
import { gateHookSpecs } from './hook-spec.js'

export interface HostHookOutcome {
  readonly spec: HookSpec
  readonly status: 'ran' | 'not-approved' | 'failed' | 'timed-out' | 'could-not-start'
  readonly result?: HookRunResult
}

export interface RunHostHooksOptions {
  readonly trusted: boolean
  /** Fingerprints, as `buildHookHandlers` takes them. */
  readonly approved: ReadonlySet<string>
  readonly fingerprint?: (identity: HookIdentity) => string
  readonly cwd: string
  /** The hook's whole environment. Required: it is never defaulted to `process.env`. */
  readonly env: Readonly<Record<string, string>>
  readonly stdin?: string
  readonly onWarn?: (message: string) => void
}

/**
 * Run the approved hooks of one event the host owns (e.g. session start), outside an agent loop.
 *
 * Same gate as `buildHookHandlers` (shared code). A hook failure is an outcome, never a throw.
 */
export async function runHostHooks(
  event: HookEvent,
  specs: readonly HookSpec[],
  options: RunHostHooksOptions,
): Promise<readonly HostHookOutcome[]> {
  const warn = options.onWarn ?? ((): void => undefined)
  const mine = specs.filter((spec) => spec.event === event)
  const { runnable, rejected } = gateHookSpecs(mine, options)
  const outcomes: HostHookOutcome[] = rejected.map((spec) => ({ spec, status: 'not-approved' }))

  for (const spec of runnable) {
    try {
      const result = await runHookCommand({
        command: spec.command,
        cwd: options.cwd,
        timeoutMs: spec.timeout_ms,
        env: options.env,
        ...(options.stdin !== undefined && { stdin: options.stdin }),
      })
      if (result.timedOut) {
        warn(`hook "${spec.command}" on ${event} timed out after ${String(spec.timeout_ms)}ms`)
        outcomes.push({ spec, status: 'timed-out', result })
      } else if (result.exitCode === null) {
        warn(`hook "${spec.command}" on ${event} could not start`)
        outcomes.push({ spec, status: 'could-not-start', result })
      } else if (result.exitCode !== 0) {
        warn(`hook "${spec.command}" on ${event} exited ${String(result.exitCode)}`)
        outcomes.push({ spec, status: 'failed', result })
      } else {
        outcomes.push({ spec, status: 'ran', result })
      }
    } catch (error) {
      warn(`hook "${spec.command}" on ${event} failed: ${(error as Error).message}`)
      outcomes.push({ spec, status: 'failed' })
    }
  }
  return outcomes
}
