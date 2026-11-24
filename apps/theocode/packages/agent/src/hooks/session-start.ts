/**
 * `SessionStart`, fired where a session actually starts.
 *
 * ## Why this is not the framework's `on_session_start`
 *
 * `build-handlers.ts` mapped it there and the event never ran. Registration was never the problem —
 * measured across two sessions: our map carries `on_session_start`, the compiled plugin registers
 * it, and a two-registration experiment (a `.hooks()` handler and a `.plugins()` handler in the same
 * turn, counted per label) showed the framework fires what is registered, 3 of 3, with a negative
 * control at 0.
 *
 * What differs is what the two names MEAN. `on_session_start` fires once per **loop context**, and
 * this product builds a new agent module **per turn** (`chat-transport.ts` calls `buildChatAgent`
 * inside `run(input)`). Honouring the mapping literally would run a `SessionStart` hook on **every
 * user message** — worse than not running it, because that is exactly the hook an author writes
 * assuming it happens once. `@theokit/sdk` now documents the cadence on its public type and names a
 * per-turn agent as the case where it bites.
 *
 * A session is this product's own concept: the surfaces mint the id (`tui-…`, `exec-…`). So the
 * surfaces fire this, once, at that moment.
 *
 * ## What this is NOT
 *
 * Not a second hook engine. Only `SessionStart` runs here; every other event stays with the
 * framework, because running one in both places would fire it twice — the same collision that keeps
 * `.claude/settings.json` hooks untranslated in `config/settings-json.ts`.
 *
 * The approval gate is not bypassed. `approved` is required, and a hook that is not approved is
 * refused and named. Firing at the surface must not become a way around the fingerprint, which is
 * the whole security model for a command that arrived with a clone.
 */
import {
  runHostHooks,
  type HostHookOutcome,
  type HookSpec as FrameworkSpec,
} from '@theokit/agents/hooks'

import { parseHooks } from './hooks.js'
import type { HookSpec } from './hooks-spec.js'

/** The variable a `SessionStart` hook reads to learn which session it is starting. */
const SESSION_ENV = 'THEOCODE_SESSION_ID'

/**
 * The `SessionStart` specs a surface should run, given the resolved configuration and the trust gate.
 *
 * The trust check is here rather than at each call site so neither surface can forget it: an
 * untrusted directory's hooks do not run, and firing at the surface must not become a second door
 * into the gate `projectSourceAllowed` guards.
 *
 * A malformed `hooks` block yields nothing rather than throwing. This runs before the operator has
 * typed anything, and the parse error is already surfaced by the path that builds the framework
 * handlers — raising it twice would refuse the session over a message it already gets.
 */
export function sessionStartSpecs(input: {
  trusted: boolean
  hooks: readonly unknown[]
}): HookSpec[] {
  if (!input.trusted) return []
  try {
    return parseHooks(input.hooks).filter((s) => s.event === 'SessionStart')
  } catch {
    return []
  }
}

function failureDetail(
  result: HostHookOutcome['result'],
  runnerWarning: string | undefined,
): string | undefined {
  const stderr = result?.stderr.trim() ?? ''
  if (stderr.length > 0) return stderr
  return /failed: (.*)$/s.exec(runnerWarning ?? '')?.[1]
}

function reportOutcome(
  outcome: HostHookOutcome,
  warn: (message: string) => void,
  runnerWarning: string | undefined,
): void {
  const { spec, result } = outcome
  if (outcome.status === 'ran') return
  if (outcome.status === 'timed-out') {
    warn(`SessionStart hook timed out after ${String(spec.timeout_ms)}ms: "${spec.command}"`)
  } else if (result !== undefined && result.exitCode !== null) {
    const detail = result.stderr.trim()
    warn(
      `SessionStart hook "${spec.command}" exit ${String(result.exitCode)}` +
        (detail.length > 0 ? ` — ${detail}` : ''),
    )
  } else {
    // Killed by a signal or never started (`exitCode` null), or the runner threw (no result): keep
    // what the process wrote, or the error the framework caught, instead of a bare "could not run".
    const detail = failureDetail(result, runnerWarning)
    warn(`SessionStart hook "${spec.command}" could not run${detail ? `: ${detail}` : ''}`)
  }
}

export interface RunSessionStartInput {
  readonly specs: readonly HookSpec[]
  readonly cwd: string
  readonly sessionId: string
  /**
   * Whether this spec passed the fingerprint gate. REQUIRED, and a predicate rather than a set, so
   * a caller cannot satisfy it by passing an empty collection and calling that "approved".
   */
  readonly approved: (spec: HookSpec) => boolean
  readonly onWarn?: (message: string) => void
}

/**
 * Run the approved `SessionStart` hooks, once.
 *
 * Never throws. A hook runs before the operator has typed anything, and refusing the whole session
 * over one is a larger punishment than the failure warrants — so a non-zero exit is reported and the
 * session continues. Reported, though: a hook that fails silently is a gate that does not gate.
 */
export async function runSessionStartHooks(input: RunSessionStartInput): Promise<void> {
  const warn = input.onWarn ?? ((): void => undefined)
  const mine = input.specs.filter((s) => s.event === 'SessionStart')

  for (const spec of mine) {
    if (!input.approved(spec)) {
      warn(
        `SessionStart hook not approved and will not run: "${spec.command}". ` +
          'Approve it by fingerprint — editing the command invalidates any previous approval.',
      )
      continue
    }
    // The surface already applied `approved`, so the framework gate is told yes for this one spec;
    // the framework runner supplies the run, the timeout and the outcome classification.
    const framework: FrameworkSpec = {
      event: 'on_session_start',
      command: spec.command,
      ...(spec.matcher !== undefined && { matcher: spec.matcher }),
      timeout_ms: spec.timeout_ms,
    }
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v
    env[SESSION_ENV] = input.sessionId
    env.CLAUDE_PROJECT_DIR = input.cwd
    let runnerWarning: string | undefined
    try {
      const [outcome] = await runHostHooks('on_session_start', [framework], {
        trusted: true,
        approved: new Set(['approved']),
        fingerprint: () => 'approved',
        cwd: input.cwd,
        env,
        onWarn: (message) => {
          runnerWarning = message
        },
      })
      if (outcome !== undefined) reportOutcome(outcome, warn, runnerWarning)
    } catch (err) {
      warn(`SessionStart hook "${spec.command}" could not run: ${(err as Error).message}`)
    }
  }
}
