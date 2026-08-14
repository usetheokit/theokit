/**
 * Hook inheritance for a delegated member — the authority a sub-agent runs under.
 *
 * ## Why this exists
 *
 * `delegate()` already merges the parent's TOOLS and clamps the parent's BUDGET into the member's
 * run. It did not carry the parent's HOOKS, so a member could call a tool the parent's
 * `pre_tool_call` gate had refused. The failure is silent and green: nothing throws, nothing warns,
 * and the member's own suite passes because the member never declared the gate.
 *
 * The only real consumer of this layer found it and closed it with sixteen lines of its own. Sixteen
 * lines standing between a squad and the parent's veto is not a consumer's job — it is authority
 * inheritance, and a consumer who does not know the rule exists has the hole and no way to see it.
 *
 * ## The composition rule: inheritance may only TIGHTEN
 *
 * A Chain of Responsibility over the two handler maps, with one asymmetry that carries the whole
 * security property: for `pre_tool_call`, BOTH gates run and the FIRST refusal wins. A member cannot
 * widen what the parent refused — if it could, the parent's gate would be decorative.
 *
 * A free function rather than a class: there is no state to hold and no second implementation to
 * swap. Wrapping a pure fold in a class would be the ceremony parsimony refuses (`parsimony-ladder`
 * rung 5), and this module's whole surface is one composition.
 *
 * ## Failure posture
 *
 * A gate that throws REFUSES. An inherited gate that opens on its own error is worse than no gate,
 * because it reads as protection — `error-handling.md § 2` forbids that swallow. Observers
 * (`post_tool_call`, session lifecycle) are fire-and-forget by contract, so a broken notifier is
 * isolated and never becomes the reason a turn failed.
 */
import type { HookHandlers } from './hook-handlers.js'

/** Both sides declared this event, or no composition is needed. */
function bothOf<T>(parent: T | undefined, own: T | undefined): readonly [T, T] | undefined {
  return parent !== undefined && own !== undefined ? [parent, own] : undefined
}

/** The code-plugin envelope the SDK dispatches hooks through. */
export interface CodePlugin {
  readonly name: string
  readonly version: string
  readonly kind: 'general'
  register(ctx: { on: (hook: string, handler: (c: never) => unknown) => void }): void
}

type PreToolCall = NonNullable<HookHandlers['pre_tool_call']>
type PreToolCallDecision = Awaited<ReturnType<PreToolCall>>

/**
 * Run every gate in order; the first refusal wins.
 *
 * Sequential, not `Promise.all`: the parent's answer is the one that may stop the member, and a
 * refusal should not wait on a slower sibling gate to resolve.
 *
 * Applied even when only ONE side has a gate, because the fail-closed property belongs to the gate
 * reaching the member, not to the fact that two of them met. A single parent gate that throws would
 * otherwise propagate and be caught — or not — by whatever sits above the member's run, which is
 * exactly the "reads as protection, behaves as nothing" state this module exists to remove.
 */
function chainVeto(...gates: readonly PreToolCall[]): PreToolCall {
  return async (ctx) => {
    for (const gate of gates) {
      let decision: PreToolCallDecision
      try {
        decision = await gate(ctx)
      } catch (cause) {
        // Fail CLOSED. The message carries the cause so an operator can tell "refused by policy"
        // from "the policy could not be consulted" — two different problems with the same outcome.
        const reason = cause instanceof Error ? cause.message : String(cause)
        return { block: true, message: `hook gate failed and refused the call: ${reason}` }
      }
      if (decision?.block === true) return decision
    }
    return undefined
  }
}

/** Run both observers; neither may prevent the other, and neither may fail the turn. */
function chainObserver<TCtx>(
  parent: (ctx: TCtx) => Promise<void> | void,
  own: (ctx: TCtx) => Promise<void> | void,
): (ctx: TCtx) => Promise<void> {
  return async (ctx) => {
    for (const observe of [parent, own]) {
      try {
        await observe(ctx)
      } catch {
        // Deliberately swallowed, and ONLY here: these events are declared fire-and-forget, so a
        // broken notifier must not be why the other one did not run. A veto gate never reaches this.
      }
    }
  }
}

/** Fold through both transforms, parent first — the parent shaped the context the member sees. */
function chainTransform<TValue, TCtx>(
  parent: (value: TValue, ctx: TCtx) => Promise<TValue> | TValue,
  own: (value: TValue, ctx: TCtx) => Promise<TValue> | TValue,
): (value: TValue, ctx: TCtx) => Promise<TValue> {
  return async (value, ctx) => own(await parent(value, ctx), ctx)
}

/**
 * Compose the four fire-and-forget events, in place.
 *
 * Explicit per event rather than an indexed loop: the observers carry DIFFERENT context types, and a
 * generic index would need a cast that erases exactly the distinction the SDK's own types make. Its
 * own function so `inheritHooks` stays readable — four near-identical lines are fine; four of them
 * buried among the veto and transform rules are not.
 */
function composeObservers(
  merged: HookHandlers,
  parent: HookHandlers | undefined,
  own: HookHandlers | undefined,
): void {
  const post = bothOf(parent?.post_tool_call, own?.post_tool_call)
  if (post) merged.post_tool_call = chainObserver(post[0], post[1])
  const start = bothOf(parent?.on_session_start, own?.on_session_start)
  if (start) merged.on_session_start = chainObserver(start[0], start[1])
  const end = bothOf(parent?.on_session_end, own?.on_session_end)
  if (end) merged.on_session_end = chainObserver(end[0], end[1])
  const reply = bothOf(parent?.post_assistant_reply, own?.post_assistant_reply)
  if (reply) merged.post_assistant_reply = chainObserver(reply[0], reply[1])
}

/**
 * Compose the hooks a delegated member actually runs under.
 *
 * A gate is never SYNTHESIZED: when neither side declared `pre_tool_call`, the member gets none, and
 * every existing caller keeps the behaviour it had. What the composition does add is the fail-closed
 * wrapper around a gate that already exists — hardening, not invention.
 *
 * @param parent the supervisor's handlers, or `undefined` when it declared none
 * @param own    the member's own handlers, or `undefined`
 */
export function inheritHooks(
  parent: HookHandlers | undefined,
  own: HookHandlers | undefined,
): HookHandlers {
  const merged: HookHandlers = { ...(parent ?? {}), ...(own ?? {}) }

  // Order matters and is the security property: the parent's refusal is evaluated first, and a
  // member can only ever ADD a reason to refuse.
  const gates = [parent?.pre_tool_call, own?.pre_tool_call].filter(
    (gate): gate is PreToolCall => gate !== undefined,
  )
  if (gates.length > 0) merged.pre_tool_call = chainVeto(...gates)

  composeObservers(merged, parent, own)

  if (parent?.transform_llm_output && own?.transform_llm_output) {
    merged.transform_llm_output = chainTransform(
      parent.transform_llm_output,
      own.transform_llm_output,
    )
  }

  return merged
}

/**
 * Wrap a handler map as the code plugin the SDK dispatches hooks through.
 *
 * Hooks and plugins are different concepts — a hook is a lifecycle interception point, a plugin is
 * an extension unit — but the SDK's transport for hooks IS the plugin seam, so a map that must reach
 * a run needs this envelope. Mirrors `compileHooksAndPlugins` in `define-agent.ts`, including
 * `kind: 'general'`, which is load-bearing: the SDK drops any plugin without it and no hook fires.
 *
 * Returns `undefined` for an empty map, so a caller with nothing to inherit appends nothing.
 */
export function hooksPlugin(handlers: HookHandlers): CodePlugin | undefined {
  const entries = Object.entries(handlers).filter(([, h]) => typeof h === 'function')
  if (entries.length === 0) return undefined
  return {
    name: 'theokit-inherited-hooks',
    version: '1.0.0',
    kind: 'general',
    register(ctx) {
      for (const [hookName, handler] of entries) {
        ctx.on(hookName, handler as (c: never) => unknown)
      }
    },
  }
}
