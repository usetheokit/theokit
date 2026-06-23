/**
 * runReflectiveLoop — the multi-round reflective driver that gives `@MainLoop`
 * its runtime (closes the metadata-only gap, V4-A / plan ADR D2).
 *
 * Per round it consumes ONE SDK stream turn (the model call stays in the SDK —
 * the factory is `createSdkAgentStream(...)`, injected for testability), derives
 * a {@link LoopOutcome}, asks the {@link ReflectionStrategy} for feedback, then
 * the {@link LoopStrategy} whether to continue. Bounded by `maxIterations`
 * (forced terminal at the ceiling — never an infinite loop). The bridge owns the
 * loop; the SDK owns the model call (sdk-runtime.md / ADR 0031 — no second runtime).
 *
 * `runReflectiveLoop` is INTERNAL (not re-exported from the package barrel,
 * Drawback #4) — consumed by `delegate()` (T2.2) and `AgentRunner` (T3.1).
 *
 * referencia: knowledge-base/references/mastra agent.ts (re-enter the loop with feedback).
 */
import {
  BudgetExceededError,
  type DelegationResult,
  DelegationError,
} from '../bridge/delegation-types.js'

import type { LoopFinishReason, LoopOutcome, LoopStrategy } from './loop-strategy.js'
import type { ReflectionStrategy } from './reflection-strategy.js'

/** One SDK stream turn: `createSdkAgentStream(...)` returns this shape. */
export type RoundStreamFactory = (
  message: string,
  sessionId: string,
) => AsyncIterable<{ type: string; [key: string]: unknown }>

/** Strategies + options for {@link runReflectiveLoop}. */
export interface RunReflectiveLoopConfig {
  /** The terminal-decision strategy (resolved from `@MainLoop.strategy`). */
  readonly loop: LoopStrategy
  /** Between-round reflection (default `'ladder'` for `'plan-act-reflect'`). */
  readonly reflection: ReflectionStrategy
  /** Cumulative USD budget across ALL rounds (EC-4). Exceeding throws BudgetExceededError. */
  readonly budget?: number
  /** Cancellation — when aborted, the loop stops re-entering and advancing the in-flight stream. */
  readonly signal?: AbortSignal
  /** Name surfaced in typed errors. */
  readonly agentName?: string
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback
}

/** One round's accumulated facts + the signals needed to derive `finishReason`. */
interface RoundResult {
  responseText: string
  toolCalls: { name: string; input: unknown; output: string }[]
  cost: number
  tokens: number
  finishReason: LoopFinishReason
  errorMessage: string
}

/**
 * Derive the round's terminal signal from the events seen this round.
 *
 * Precedence (B1 — the load-bearing fix):
 *  1. error event           ⇒ 'error'
 *  2. explicit done.finishReason==='tool-calls' ⇒ 'tool-calls' (if a future SDK adapter sets it)
 *  3. ANY tool_result seen  ⇒ 'tool-calls' — the turn USED TOOLS ("still working"), so the
 *     outer reflective loop should reflect + re-prompt. The real `@theokit/sdk` adapter ALWAYS
 *     appends a terminal `done` WITHOUT finishReason after a turn (sdk-adapter.ts / event-translator.ts);
 *     letting that `done` short-circuit a tool-using turn to 'stop' is exactly what made the loop
 *     dead in production (single-round). tool_result therefore OUTRANKS the bare done. Bounded by
 *     `maxIterations` so it can never spin.
 *  4. otherwise (pure-answer `done`, text-only, or empty round) ⇒ 'stop' (terminal). EC-1: a
 *     degenerate/empty round defaults to 'stop', NEVER 'tool-calls'.
 *
 * This is an honest heuristic: the SDK runs the inner tool loop to completion per turn, so the
 * outer loop treats a tool-using turn as "continue/reflect" and a pure-text answer as "done".
 */
function deriveFinishReason(signals: {
  sawError: boolean
  sawDone: boolean
  doneFinishReason: string
  sawToolResult: boolean
}): LoopFinishReason {
  if (signals.sawError) return 'error'
  if (signals.sawDone && signals.doneFinishReason === 'tool-calls') return 'tool-calls'
  if (signals.sawToolResult) return 'tool-calls'
  return 'stop'
}

/** Consume exactly one SDK stream turn and derive its {@link LoopFinishReason}. */
async function consumeOneRound(
  factory: RoundStreamFactory,
  prompt: string,
  sessionId: string,
  signal: AbortSignal | undefined,
): Promise<RoundResult> {
  const r: RoundResult = {
    responseText: '',
    toolCalls: [],
    cost: 0,
    tokens: 0,
    finishReason: 'stop',
    errorMessage: '',
  }
  const signals = { sawError: false, sawDone: false, doneFinishReason: '', sawToolResult: false }

  for await (const event of factory(prompt, sessionId)) {
    if (signal?.aborted) break // cancellation: stop advancing the iterator
    if (event.type === 'text_delta' && typeof event.content === 'string') {
      r.responseText += event.content
    } else if (event.type === 'tool_result') {
      signals.sawToolResult = true
      r.toolCalls.push({
        name: asString(event.toolName, 'unknown'),
        input: event.input ?? {},
        output: asString(event.output, ''),
      })
    } else if (event.type === 'done') {
      signals.sawDone = true
      signals.doneFinishReason = asString(event.finishReason, '')
      r.cost = asNumber(event.cost, 0)
      r.tokens = (event.usage as { totalTokens?: number } | undefined)?.totalTokens ?? 0
    } else if (event.type === 'error') {
      signals.sawError = true
      r.errorMessage = asString((event as { message?: unknown }).message, 'Unknown agent error')
    }
  }

  r.finishReason = deriveFinishReason(signals)
  return r
}

/**
 * Drive the reflective loop to a terminal {@link DelegationResult}.
 *
 * Terminates when: the reflection/strategy says stop, the `maxIterations` ceiling
 * is reached (via `loop.shouldContinue`), the signal aborts, or a degenerate round
 * resolves to `stop`. Throws `DelegationError` on a mid-round error event
 * (fail-fast, typed) and `BudgetExceededError` when cumulative cost crosses `budget`.
 */
export async function runReflectiveLoop(
  factory: RoundStreamFactory,
  message: string,
  sessionId: string,
  config: RunReflectiveLoopConfig,
): Promise<DelegationResult> {
  const {
    loop,
    reflection,
    budget = Number.POSITIVE_INFINITY,
    signal,
    agentName = loop.name,
  } = config
  const acc: DelegationResult = { response: '', toolCalls: [], cost: 0, tokens: 0, rounds: 0 }
  let round = 1
  let feedback: string | undefined

  while (!signal?.aborted) {
    // L2: only append the [reflection] block when there is actual feedback (react's
    // noop reflection returns no feedback — avoid polluting its prompt with an empty marker).
    const prompt = round === 1 || !feedback ? message : `${message}\n\n[reflection] ${feedback}`
    // M2: wrap the round so a RAW stream/iterator exception (not an `error` event — e.g. the
    // SDK dynamic import rejecting) surfaces as a typed DelegationError, matching the single-shot path.
    let r: RoundResult
    try {
      r = await consumeOneRound(factory, prompt, sessionId, signal)
    } catch (err) {
      if (err instanceof BudgetExceededError || err instanceof DelegationError) throw err
      throw new DelegationError(agentName, err)
    }

    acc.response += r.responseText
    acc.toolCalls.push(...r.toolCalls)
    acc.cost += r.cost
    acc.tokens += r.tokens

    if (r.finishReason === 'error') throw new DelegationError(agentName, r.errorMessage)
    if (Number.isFinite(budget) && acc.cost > budget) {
      throw new BudgetExceededError(agentName, acc.cost, budget)
    }

    const outcome: LoopOutcome = {
      finishReason: r.finishReason,
      round,
      toolCalls: r.toolCalls,
      responseText: r.responseText,
    }
    const reflectionResult = reflection.reflect(outcome)
    if (!(reflectionResult.continue && loop.shouldContinue(outcome))) {
      acc.rounds = round
      // Wiring triad — runtime metric (G10): observable proof the loop ran, with round count.
      // Fires for BOTH on-ramps (delegate + AgentRunner) since both share this driver.
      console.debug('[THEO_AGENT_MAINLOOP_RUNTIME_APPLIED]', { strategy: loop.name, rounds: round })
      return acc
    }

    feedback = reflectionResult.feedback
    round += 1
  }

  // Aborted before (re-)entering a round. L1: record the rounds that DID run
  // (round is 1-indexed and points at the next round, so `round - 1` ran).
  acc.rounds = round - 1
  return acc
}
