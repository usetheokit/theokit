import {
  buildHookHandlers as buildInFramework,
  DEFAULT_CONTINUATION_BUDGET,
  type HookEvent as FrameworkEvent,
  type HookSpec as FrameworkSpec,
} from '@theokit/agents/hooks'
import type { HookHandlers } from '@theokit/agents'

import { hookFingerprint } from './hook-trust.js'
import type { HookEvent, HookSpec } from './hooks-spec.js'

/**
 * Compile this product's hook specs using the framework's engine.
 *
 * ## What moved
 *
 * The whole builder — the veto chain, the per-event grouping, the result transform with its
 * continuation budget, the fail-closed/fail-open asymmetry — is `@theokit/agents/hooks` now. What
 * remains here is the two things the framework cannot know: our EVENT NAMES and our FINGERPRINT.
 *
 * ## The event names, and why they stay ours
 *
 * `.theokit/hooks.json` is written by users, and it uses Claude Code's names — `PreToolUse`,
 * `PostToolUse`, `Stop`, `SessionStart`. The framework declares its own eight in snake_case, and its
 * schema is `.strict()`: handing it a file with `PreToolUse` in it would throw at boot for everyone
 * who already has one. So the parser stays ours and the translation happens HERE, once, on the way
 * into the engine.
 *
 * The mapping is not a rename. `PostToolUse` becomes `transform_tool_result`, not `post_tool_call`:
 * this product's PostToolUse hooks APPEND FEEDBACK the model then sees, which is what
 * `transform_tool_result` is for and what `post_tool_call` is not. That decision predates the
 * framework — it is what the deleted builder did — and reading it off the old code is the only
 * reason this migration could be mechanical.
 *
 * ## The fingerprint, and the trap in it
 *
 * The approval store on disk is keyed by OUR fingerprint, computed from the ORIGINAL spec —
 * PascalCase event, `timeout_ms`. The framework hands its injected function the TRANSLATED identity.
 * Hashing that would produce a value no stored approval can match, and every hook would come back
 * "not approved and will not run" — a warning per hook and silence afterwards.
 *
 * So the translation keeps a way back: each translated spec remembers the original it came from, and
 * the injected function hashes the original. The store is never touched, and no operator is asked to
 * re-approve anything.
 */

/**
 * Which framework handler each of our events becomes.
 *
 * Declared as a total map over `HookEvent` so adding an event to `hooks-spec.ts` fails to compile
 * until somebody decides where it goes — which is the point. A partial map would let a new event
 * parse, fingerprint, be approved, and silently do nothing.
 */
/**
 * `null` means THIS PRODUCT delivers the event, not the framework.
 *
 * Kept in the map rather than removed, because the map is total over `HookEvent` and the totality is
 * the guard: a new event fails to compile until somebody decides where it goes. Deleting the entry
 * would restore exactly the silence the docblock below warns about, while `null` states the decision
 * and keeps the compile error.
 */
type Delivery = FrameworkEvent | null

const EVENT_TO_FRAMEWORK: Readonly<Record<HookEvent, Delivery>> = {
  PreToolUse: 'pre_tool_call',
  // NOT `post_tool_call`: our PostToolUse hooks append feedback the model reads, which is what
  // `transform_tool_result` does and what a notification-shaped `post_tool_call` does not.
  PostToolUse: 'transform_tool_result',
  Stop: 'post_assistant_reply',
  // `hooks/session-start.ts` fires this, at the moment a surface mints a session id.
  //
  // It used to be `on_session_start`, and the event never ran. Registration was never the problem —
  // measured: our map carried it, the compiled plugin registered it, and the framework fires what is
  // registered. What differs is MEANING: `on_session_start` is once per loop context, and this
  // product builds a new agent module per turn, so the mapping would run a `SessionStart` hook on
  // every user message. That is worse than not running it, because it is exactly the hook an author
  // writes assuming it happens once.
  //
  // `null` here is what stops it being delivered twice once the surface fires it.
  SessionStart: null,
}

export interface BuildHookHandlersOptions {
  readonly trusted: boolean
  /**
   * B-021 — REQUIRED. It was once optional, and the absent-value branch installed every parsed spec
   * with no fingerprint check: the gate B-008 exists to enforce, disabled by omission and
   * typechecking cleanly. The default is the denial.
   */
  readonly approved: ReadonlySet<string>
  /**
   * B-055 — called when a PreToolUse hook VETOES a call, so a surface can say so.
   *
   * The signal has to come from the engine. A veto makes the loop surface a tool_result the model
   * can self-correct from, so on the wire it is indistinguishable from a successful call — which is
   * why B-027 deleted a renderer that tried to recognise it there. The framework grew this callback
   * (8.3.0) precisely because this product needed it.
   *
   * Optional because a headless surface has nobody to tell. Not a security default: the veto blocks
   * either way.
   */
  readonly onVeto?: (veto: { tool: string; reason: string }) => void
  readonly cwd?: string
  readonly onWarn?: (message: string) => void
}

export function buildHookHandlers(
  specs: readonly HookSpec[],
  opts: BuildHookHandlersOptions,
): HookHandlers {
  // Each translated spec remembers where it came from, so the fingerprint below can hash the
  // original — the only form the approval store knows.
  const origin = new Map<FrameworkSpec, HookSpec>()
  // Events this product delivers itself are filtered out BEFORE translation, so the framework never
  // sees a spec it would fire in parallel with the surface.
  const delegated = specs.filter((spec) => EVENT_TO_FRAMEWORK[spec.event] !== null)
  const translated = delegated.map((spec) => {
    const next: FrameworkSpec = {
      command: spec.command,
      // Non-null by construction: `delegated` dropped every event this product delivers itself.
      event: EVENT_TO_FRAMEWORK[spec.event] as FrameworkEvent,
      ...(spec.matcher !== undefined && { matcher: spec.matcher }),
      timeout_ms: spec.timeout_ms,
    }
    origin.set(next, spec)
    return next
  })

  return buildInFramework(translated, {
    cwd: opts.cwd ?? process.cwd(),
    trusted: opts.trusted,
    approved: opts.approved,
    continuationBudget: DEFAULT_CONTINUATION_BUDGET,
    ...(opts.onVeto !== undefined && { onVeto: opts.onVeto }),
    ...(opts.onWarn !== undefined && { onWarn: opts.onWarn }),
    // The trap, closed. The framework passes the TRANSLATED identity; the store knows the ORIGINAL.
    // Hashing what we are given would match nothing and refuse every hook, silently.
    fingerprint: (identity) => {
      const match = [...origin.entries()].find(
        ([spec]) => spec.command === identity.command && spec.event === identity.event,
      )
      if (match === undefined) {
        // Unreachable through this function, which only ever sees specs it just translated. Throwing
        // rather than returning a made-up hash: a fingerprint nobody can match refuses the hook and
        // says nothing, and this is exactly the failure this whole indirection exists to avoid.
        throw new Error(
          `hook fingerprint requested for a spec this layer did not translate: ${identity.command}`,
        )
      }
      return hookFingerprint(match[1])
    },
  })
}
