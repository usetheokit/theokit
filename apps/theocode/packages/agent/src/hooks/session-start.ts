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
 * surfaces fire this, once, at that moment — through the framework's `runHostHooks`, which owns the
 * gate and the process run; what stays here is the trust check, the session variable and the wording.
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
import { runHostHooks } from '@theokit/agents/hooks'

import { hookFingerprint } from './hook-trust.js'
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

type Outcome = Awaited<ReturnType<typeof runHostHooks>>[number]

/** This product's wording for a hook outcome; `undefined` when it ran cleanly. */
function describeOutcome(
  { spec, status, result }: Outcome,
  frameworkWarnings: readonly string[],
): string | undefined {
  if (status === 'not-approved') {
    return (
      `SessionStart hook not approved and will not run: "${spec.command}". ` +
      'Approve it by fingerprint — editing the command invalidates any previous approval.'
    )
  }
  if (status === 'timed-out') {
    return `SessionStart hook timed out after ${String(spec.timeout_ms)}ms: "${spec.command}"`
  }
  if (status === 'failed' || status === 'could-not-start') {
    if (result === undefined) {
      // The runner threw before producing a result; its only record of why is the warning it raised.
      const why = frameworkWarnings.find((w) => w.includes(spec.command)) ?? 'unknown error'
      return `SessionStart hook "${spec.command}" could not run — ${why}`
    }
    const detail = result.stderr.trim()
    return (
      `SessionStart hook "${spec.command}" exit ${String(result.exitCode)}` +
      (detail.length > 0 ? ` — ${detail}` : '')
    )
  }
  return undefined
}

/**
 * Run the approved `SessionStart` hooks, once, through the framework's host-event runner.
 *
 * Never throws. A hook runs before the operator has typed anything, and refusing the whole session
 * over one is a larger punishment than the failure warrants — so a non-zero exit is reported and the
 * session continues. Reported, though: a hook that fails silently is a gate that does not gate.
 */
export async function runSessionStartHooks(input: RunSessionStartInput): Promise<void> {
  const warn = input.onWarn ?? ((): void => undefined)
  const mine = input.specs.filter((s) => s.event === 'SessionStart')
  if (mine.length === 0) return

  // The approval store is keyed by OUR fingerprint (PascalCase event); the framework hands its
  // injected function the translated identity, so hash the original it came from.
  const keyOf = (s: { command: string; matcher?: string; timeoutMs: number }): string =>
    JSON.stringify([s.command, s.matcher ?? '', s.timeoutMs])
  const origin = new Map<string, HookSpec>()
  const approved = new Set<string>()
  const translated = mine.map((spec) => {
    origin.set(keyOf({ ...spec, timeoutMs: spec.timeout_ms }), spec)
    if (input.approved(spec)) approved.add(hookFingerprint(spec))
    return {
      event: 'on_session_start' as const,
      command: spec.command,
      ...(spec.matcher !== undefined && { matcher: spec.matcher }),
      timeout_ms: spec.timeout_ms,
    }
  })

  const frameworkWarnings: string[] = []
  let outcomes: readonly Outcome[]
  try {
    outcomes = await runHostHooks('on_session_start', translated, {
      trusted: true,
      approved,
      fingerprint: (identity) => {
        const original = origin.get(keyOf(identity))
        return original === undefined ? '' : hookFingerprint(original)
      },
      cwd: input.cwd,
      onWarn: (m) => frameworkWarnings.push(m),
      env: { ...process.env, [SESSION_ENV]: input.sessionId } as Record<string, string>,
    })
  } catch (err) {
    warn(`SessionStart hooks could not run: ${(err as Error).message}`)
    return
  }

  for (const outcome of outcomes) {
    const message = describeOutcome(outcome, frameworkWarnings)
    if (message !== undefined) warn(message)
  }
}
