import type { BudgetTracker, BudgetUsageEvent } from '@theokit/sdk'

/**
 * The run's REAL token usage, reachable from inside a tool handler.
 *
 * ## The gap this closes
 *
 * A coding agent that wants to manage a long task the way Codex's `get_context_remaining` does needs
 * one number from inside a tool: how much of the context window this run has already spent. Measured
 * against this package, there were four routes to it and none arrived:
 *
 *  1. The tool handler's `ctx` is `{signal, context, messages, threadId}`. `messages` is a text-only
 *     projection of the transcript — a tool can COUNT it, but counting is an estimate.
 *  2. No hook context carries usage: `PostAssistantReplyContext` is `{prompt, reply, agentId, runId}`.
 *  3. `BudgetTracker` does carry real provider counts, but it is an `Agent.create` option nobody
 *     inside a tool holds, and the compiled agent exposes no seam to install one.
 *  4. The number a surface displays is read surface-side, off the client thread — outside this
 *     package entirely, and unreachable from a handler running inside the loop.
 *
 * What was left was `~4 chars per token` over `ctx.messages`. An estimate presented as a measurement
 * is the failure mode this layer already paid for once (M93 classified transience by a regex over an
 * error message and read `ECONNREFUSED …:443` as a 4xx). A consumer that refuses to ship that and
 * ships nothing instead is making the right call with the wrong options.
 *
 * ## Where the number comes from — the provider, never an estimate
 *
 * `BudgetTracker.track(event)` is called by the SDK agent loop after EACH LLM completion, with the
 * provider's own `inputTokens` / `outputTokens` (verified in the shipped `@theokit/sdk@4.52.1`
 * bundle: `chunk-KELIQH7K.js:6325-6345`, inside `runIteration`, immediately after `streamLlmTurn`
 * and BEFORE the tool dispatch of that same iteration — so a tool called on iteration N reads the
 * usage of iterations 1..N).
 *
 * The SDK's own `.d.ts` disclaims that wiring ("wired to the type surface only … consumers passing a
 * custom tracker today get the type guarantee but NOT runtime enforcement"), and
 * `sdk-adapter.ts::applyStepCeiling` refuses to build the step cap on it for exactly that reason.
 * That refusal was right for a CAP and does not transfer to a READING, because the two fail in
 * opposite directions: a cap built on a disclaimed option silently stops capping, while a reading
 * built on it silently reports **nothing** — and "nothing" is what {@link RunUsageSnapshot} is
 * designed to say. An SDK that does not call `track()` leaves this seam answering `undefined`
 * forever, which is true, rather than answering `0`, which would not be.
 *
 * ## `undefined` and `0` are different facts
 *
 * `snapshot()` returns `undefined` until the FIRST provider report arrives, and the tokens it then
 * reports are only ever ones a provider stated. "We do not know yet" and "zero tokens were used" are
 * both real states of a run and only one of them is ever true at a time; collapsing them into `0`
 * would hand the model a number to reason with in the exact rounds where there is nothing to reason
 * from.
 */

/**
 * A reading of the run's token usage so far. Every field is provider-reported or derived from
 * provider-reported values — nothing here is estimated.
 */
export interface RunUsageSnapshot {
  /** Prompt tokens the provider has reported across this run's completed LLM calls. */
  readonly inputTokens: number
  /** Completion tokens the provider has reported across this run's completed LLM calls. */
  readonly outputTokens: number
  /** `inputTokens + outputTokens`. */
  readonly totalTokens: number
  /**
   * The model's context window in tokens — present ONLY when the caller DECLARED one
   * (`ModelSelection.contextWindow`), which is the same input the SDK's own
   * `resolveEffectiveContextWindow` treats as the authoritative `override`.
   *
   * Absent for a bare-string model id, and deliberately NOT filled from
   * `resolveModelCapabilities(modelId).maxContextTokens`: that resolver answers unknown models with
   * "conservative defaults (all false, minimum tokens)" and returns no flag saying which happened,
   * so a catalog miss is indistinguishable from a catalog hit. A window invented for an unknown
   * model is the same plausible-looking lie as an estimated token count, one layer up.
   */
  readonly contextWindowTokens?: number
  /**
   * `contextWindowTokens - totalTokens`, floored at zero. Present exactly when
   * {@link contextWindowTokens} is — "remaining" needs both halves, and reporting it from one would
   * be reporting a subtraction against a number nobody supplied.
   */
  readonly remainingTokens?: number
}

/**
 * Read {@link RunUsageSnapshot} off a tool handler's `ctx`.
 *
 * The typed door into a field the SDK's `ToolContext` does not declare. The adapter injects `usage`
 * the same way it injects `context` (M7): theokit owns the concern, so theokit puts it on the ctx
 * rather than waiting for the SDK's tool-call internals to forward it. Reading it through this
 * function instead of `(ctx as {usage}).usage` keeps the cast in ONE place and keeps a consumer from
 * inventing its own idea of the shape.
 *
 * Returns `undefined` for every honest form of "not known": the surface did not opt in
 * (`exposeUsageToTools`), no provider report has arrived yet, or the ctx is not a tool ctx at all.
 * A caller that must distinguish those three has a design question, not a data question — every one
 * of them means the same thing to a model asking how much room is left.
 */
export function readRunUsage(ctx: unknown): RunUsageSnapshot | undefined {
  const usage = (ctx as { usage?: unknown } | null | undefined)?.usage
  if (typeof usage !== 'object' || usage === null) return undefined
  // `totalTokens` is the field that only a real snapshot has; checking it (rather than trusting the
  // key's presence) means a consumer that puts something else on `ctx.usage` gets `undefined` back
  // instead of a value this layer never produced.
  return typeof (usage as { totalTokens?: unknown }).totalTokens === 'number'
    ? (usage as RunUsageSnapshot)
    : undefined
}

/**
 * The write half: a {@link BudgetTracker} the adapter installs on `Agent.create`, paired with the
 * reader every tool handler is given.
 */
export interface RunUsageMeter {
  /**
   * The tracker to hand to `Agent.create({ budgetTracker })`. It is also the caller's own tracker
   * when one was supplied — see {@link createRunUsageMeter}.
   */
  readonly tracker: BudgetTracker
  /** The usage so far, or `undefined` while no provider report has arrived. */
  snapshot(): RunUsageSnapshot | undefined
}

/**
 * Build a meter for one run.
 *
 * `delegate` is the caller's own `budgetTracker`, when the run declared one. The meter WRAPS it
 * rather than replacing it: `Agent.create` takes a single tracker, and a reading seam that silently
 * disarmed a consumer's budget gate would trade an observability feature for a spend incident.
 * `check()` / `getTotal()` / `nextIteration()` therefore answer from the delegate whenever there is
 * one, and `nextIteration` is forwarded only when the delegate itself declares it — the SDK calls it
 * through `?.`, so inventing the method would change which trackers halt on `maxIterations`.
 *
 * `contextWindowTokens` is the DECLARED window (see {@link RunUsageSnapshot.contextWindowTokens});
 * omitted when the run's model did not declare one.
 */
export function createRunUsageMeter(
  options: { contextWindowTokens?: number; delegate?: BudgetTracker } = {},
): RunUsageMeter {
  const { contextWindowTokens, delegate } = options
  let inputTokens = 0
  let outputTokens = 0
  // The one bit that separates "not known yet" from "zero". It flips on a provider report and never
  // back, so it is not the same question as `totalTokens > 0`: a provider that reports a completion
  // with zero output tokens has told us something, and this seam must repeat it rather than round it
  // back into silence.
  let reported = false

  const tracker: BudgetTracker = {
    track(event: BudgetUsageEvent): void {
      reported = true
      if (event.type === 'input') inputTokens += event.tokens
      else outputTokens += event.tokens
      // Record-only, and non-throwing by the SDK's contract for `track`. A delegate that throws
      // would abort the SDK's own recording of the same event, so its failure is left to `check()`,
      // which is where the contract says validation failures surface.
      delegate?.track(event)
    },
    check: () => delegate?.check() ?? { allowed: true },
    getTotal: () => delegate?.getTotal() ?? { tokens: inputTokens + outputTokens },
    ...(delegate?.nextIteration !== undefined
      ? { nextIteration: (): void => delegate.nextIteration?.() }
      : {}),
  }

  return {
    tracker,
    snapshot(): RunUsageSnapshot | undefined {
      if (!reported) return undefined
      const totalTokens = inputTokens + outputTokens
      return {
        inputTokens,
        outputTokens,
        totalTokens,
        ...(contextWindowTokens !== undefined
          ? {
              contextWindowTokens,
              // Floored: a provider that reports more tokens than the declared window has
              // contradicted the declaration, and "-2000 remaining" is not a fact about anything.
              remainingTokens: Math.max(0, contextWindowTokens - totalTokens),
            }
          : {}),
      }
    },
  }
}
