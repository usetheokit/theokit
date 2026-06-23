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
} from '../bridge/agent-orchestrator.js'

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
 * Derive the round's terminal signal. EC-1: anything other than the explicit
 * signals defaults to `'stop'` (terminal), NEVER `'tool-calls'` — so a
 * degenerate/empty round can never spin the loop.
 */
function deriveFinishReason(signals: {
  sawError: boolean
  sawDone: boolean
  doneFinishReason: string
  sawToolResult: boolean
}): LoopFinishReason {
  if (signals.sawError) return 'error'
  if (signals.sawDone) return signals.doneFinishReason === 'tool-calls' ? 'tool-calls' : 'stop'
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
  const acc: DelegationResult = { response: '', toolCalls: [], cost: 0, tokens: 0 }
  let round = 1
  let feedback: string | undefined

  while (!signal?.aborted) {
    const prompt = round === 1 ? message : `${message}\n\n[reflection] ${feedback ?? ''}`
    const r = await consumeOneRound(factory, prompt, sessionId, signal)

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
    if (!(reflectionResult.continue && loop.shouldContinue(outcome))) return acc

    feedback = reflectionResult.feedback
    round += 1
  }

  return acc // aborted before (re-)entering a round
}
