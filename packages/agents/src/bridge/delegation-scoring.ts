/**
 * M25 (theokit-ai-first) — background delegation + task-completion scoring.
 *
 * Two THIN wrappers over the M12 `delegate` (ADR 0038/0040): no new orchestration engine, no second
 * loop, no new store. `delegateBackground` kicks off a sub-agent without blocking the supervisor and
 * hands back a handle to await later. `delegateWithScoring` runs `delegate`, scores the result with
 * an injected scorer, and re-delegates with the scorer's feedback until it passes or `maxRounds` is
 * hit. The `delegate` implementation is injectable (`delegateFn`) so this is testable without a
 * SubAgent class or an LLM — and so it NEVER re-implements the delegation runtime.
 */
import { delegate, type DelegateOptions, type SubAgentSpec } from './agent-orchestrator.js'
import type { DelegationResult } from './delegation-types.js'

/** The delegation primitive both wrappers drive. Defaults to the M12 {@link delegate}. */
export type DelegateFn = (
  subAgent: SubAgentSpec,
  message: string,
  opts?: DelegateOptions,
) => Promise<DelegationResult>

/** A running background delegation the supervisor can await/poll later. */
export interface BackgroundDelegation {
  /** Await the sub-agent's result (or rejection). Idempotent — returns the same settled promise. */
  wait(): Promise<DelegationResult>
  /** Whether the underlying delegation has resolved or rejected. */
  settled(): boolean
}

/**
 * Start a sub-agent WITHOUT blocking the supervisor. Returns immediately with a handle; the
 * supervisor keeps working and calls `wait()` when it needs the result. A thin async wrapper over
 * `delegate` — not a scheduler (Top-risk 1). Rejections are still observable via `wait()`.
 */
export function delegateBackground(
  subAgent: SubAgentSpec,
  message: string,
  opts: DelegateOptions & { delegateFn?: DelegateFn } = {},
): BackgroundDelegation {
  const { delegateFn = delegate, ...delegateOpts } = opts
  let isSettled = false
  const promise = delegateFn(subAgent, message, delegateOpts).finally(() => {
    isSettled = true
  })
  // Swallow the unhandled-rejection warning: the rejection surfaces through wait().
  promise.catch(() => undefined)
  return {
    wait: () => promise,
    settled: () => isSettled,
  }
}

/** A scorer's verdict on a sub-agent result. `feedback` is fed back into the next round on failure. */
export interface ScoreVerdict {
  pass: boolean
  /** Optional numeric score (0..1) for logging/telemetry. */
  score?: number
  /** Guidance appended to the next delegation when `pass` is false. */
  feedback?: string
}

/** Scores a sub-agent result. Opt-in (Top-risk 2) — the caller supplies it, and pays its cost. */
export type Scorer = (result: DelegationResult) => ScoreVerdict | Promise<ScoreVerdict>

/** The outcome of a scored delegation: the final result plus the per-round verdict trail. */
export interface ScoredDelegation {
  result: DelegationResult
  /** Rounds actually run (1..maxRounds). */
  rounds: number
  /** Whether the final round passed the scorer. */
  passed: boolean
  /** The verdict from each round, in order. */
  verdicts: ScoreVerdict[]
}

const DEFAULT_MAX_ROUNDS = 3

/** Default: append the scorer feedback under a `Feedback:` header for the next round. */
function defaultFeedbackTemplate(message: string, feedback: string): string {
  return `${message}\n\nFeedback from the reviewer (address this): ${feedback}`
}

/**
 * Run `delegate`, score the result, and re-delegate with the scorer's feedback until it passes or
 * `maxRounds` is reached. Each round is ONE `delegate` call — no second loop, no new store. Returns
 * the final result (passing, or the last attempt) with the per-round verdict trail.
 */
export async function delegateWithScoring(
  subAgent: SubAgentSpec,
  message: string,
  opts: DelegateOptions & {
    scorer: Scorer
    maxRounds?: number
    delegateFn?: DelegateFn
    feedbackTemplate?: (message: string, feedback: string) => string
  },
): Promise<ScoredDelegation> {
  const {
    scorer,
    maxRounds: maxRoundsOpt = DEFAULT_MAX_ROUNDS,
    delegateFn = delegate,
    feedbackTemplate = defaultFeedbackTemplate,
    ...delegateOpts
  } = opts
  // Clamp to ≥ 1 so at least one delegate call always runs (guarantees a result).
  const maxRounds = Math.max(1, maxRoundsOpt)

  const verdicts: ScoreVerdict[] = []
  let currentMessage = message
  let lastResult: DelegationResult | undefined

  for (let round = 1; round <= maxRounds; round++) {
    const result = await delegateFn(subAgent, currentMessage, delegateOpts)
    lastResult = result
    const verdict = await scorer(result)
    verdicts.push(verdict)
    if (verdict.pass) {
      return { result, rounds: round, passed: true, verdicts }
    }
    // Failed — fold the feedback into the next round's message (if any feedback was given).
    if (verdict.feedback) currentMessage = feedbackTemplate(message, verdict.feedback)
  }

  // Exhausted maxRounds without passing — return the last attempt honestly (passed: false).
  // The clamped `maxRounds >= 1` guarantees at least one delegate call — but assert it instead of
  // asserting the type away: if the invariant ever breaks, fail loudly rather than return undefined.
  if (lastResult === undefined) {
    throw new Error('[@theokit/agents] delegateWithScoring: no round ran (maxRounds < 1)')
  }
  return {
    result: lastResult,
    rounds: maxRounds,
    passed: false,
    verdicts,
  }
}
