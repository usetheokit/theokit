/**
 * `@theokit/agents/evals` — run cases against a theokit agent and read pass, fail or error per case.
 *
 * A subpath rather than a member of the root barrel: evaluation is development-time work most apps
 * never import, and the root bundle sits close to its cap (B-413).
 *
 * `Scorers` and `EvalAlreadyRunningError` cross from `@theokit/sdk/eval` as the SDK's own
 * references, so a consumer builds a scorer and catches an overlapping run without importing the
 * SDK. The SDK's `Eval` itself does not cross: it evaluates a bare model, which is what this subpath
 * exists to avoid.
 */
export { EvalConfigError, runAgentEvals } from './evals/run-agent-evals.js'
export type {
  AgentEvalCase,
  AgentEvalCaseResult,
  AgentEvalResult,
  AgentEvalVerdict,
  RunAgentEvalsOptions,
} from './evals/run-agent-evals.js'
export { EvalAlreadyRunningError, Scorers } from '@theokit/sdk/eval'
export type { NamedScorer, Scorer } from '@theokit/sdk/eval'
