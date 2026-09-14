/**
 * B-080 — a run in which the agent may plan and may not act.
 *
 * ## The mode already had a name, and nothing honoured it
 *
 * The SDK declares `PermissionMode = "default" | "plan" | "acceptEdits" | "bypass" |
 * "bypassPermissions"`. Measured 2026-09-14 across `packages/agents/src`: `default` 4 times,
 * `acceptEdits` once, `bypass` once, and **`plan` zero times** — of the five modes the type carries,
 * the one meaning "do not act" is the single one this layer never mentioned. Accepted by the type
 * and consulted by nobody, which is the shape this backlog keeps closing.
 *
 * So nothing here invents a mode. It makes the declared one refuse.
 *
 * ## Refusing, never skipping
 *
 * A silently skipped call leaves the agent believing it succeeded, so the plan reads as executed.
 * That is the one outcome nobody can detect afterwards — worse than an error, which is why this
 * throws a typed error naming both the mode and the tool (`rules/error-handling.md` § 2).
 *
 * ## Compose, never assign
 *
 * `auth/permission-gate.ts` states the hazard in its own docblock: `HookHandlers.pre_tool_call` is a
 * SINGLE field, so assigning this over an existing handler loses one of the two silently — *"and
 * worse here because the handler that loses may be the one that refuses."* The documented shape is:
 *
 * ```ts
 * pre_tool_call: async (ctx) => (await planOnly(ctx)) ?? (await mine(ctx))
 * ```
 *
 * First veto wins; `undefined` falls through. No helper ships for that: it is one line, and a
 * `composePreToolCall` would be a second way to do what `??` already does.
 *
 * ## What counts as state-changing is the CONSUMER's decision
 *
 * `permission-gate.ts` already established why: a context carries `{ name, args }` with no notion of
 * which argument is the command, and that differs per tool. The classifier is passed in rather than
 * guessed, and this module does not invent a second taxonomy of dangerous tools.
 */
import { TheokitAgentError } from '@theokit/sdk/errors'

/** Refused because the run is in `plan` mode. Typed so a consumer can catch this and only this. */
export class PlanOnlyRefusalError extends TheokitAgentError {
  override readonly name = 'PlanOnlyRefusalError'
  /** The tool whose call was refused, so a handler can report it without parsing the message. */
  readonly tool: string

  constructor(tool: string) {
    super(
      `refusing to run '${tool}': this run is in 'plan' permission mode, where the agent may ` +
        `decompose the work and may not change state. This is a REFUSAL, not a skip — a skipped ` +
        `call would leave the agent believing it succeeded and the plan reading as executed, which ` +
        `is the one outcome nobody can detect afterwards. Declare the work instead, and let the ` +
        `caller decide whether to leave plan mode.`,
      { code: 'PLAN_ONLY_REFUSAL' },
    )
    this.tool = tool
  }
}

/** The slice of a pre-tool-call context this gate reads. Structural, so it fits the SDK's shape. */
export interface PlanOnlyContext {
  readonly name: string
  readonly permissionMode?: string
}

export interface PlanOnlyGateOptions {
  /**
   * Does calling this tool change state that outlives the turn?
   *
   * The consumer's decision, for the reason `permission-gate.ts` records: the package cannot know
   * which argument is the command, and a guessed taxonomy would be wrong per tool.
   */
  readonly isStateChanging: (toolName: string) => boolean
}

/**
 * A `pre_tool_call` handler that refuses state-changing calls while the run is in `plan` mode.
 *
 * Returns `undefined` in every other case, so it composes with `??` rather than replacing whatever
 * handler a consumer already has.
 */
export function createPlanOnlyGate(options: PlanOnlyGateOptions) {
  // `async` with nothing awaited, deliberately. The `pre_tool_call` contract is a promise, and the
  // documented composition is `(await gate(ctx)) ?? (await mine(ctx))` — so `async` is what makes the
  // refusal below a REJECTION rather than a synchronous throw. A sync throw would escape that
  // expression before `await` could turn it into one, and a consumer catching on the promise would
  // never see the refusal at all.
  // eslint-disable-next-line @typescript-eslint/require-await -- see the paragraph above
  return async (ctx: PlanOnlyContext): Promise<undefined> => {
    // Any other mode is left entirely alone. A gate that narrowed behaviour outside the mode it is
    // named for would be a surprise, and a surprising gate is a gate somebody disables.
    if (ctx.permissionMode !== 'plan') return undefined

    // Declaring, reading and reasoning stay allowed. Refusing everything would produce a mode that
    // yields no plan — the capability defeating its own purpose.
    if (!options.isStateChanging(ctx.name)) return undefined

    throw new PlanOnlyRefusalError(ctx.name)
  }
}
