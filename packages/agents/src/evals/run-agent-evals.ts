/**
 * B-413 — run a list of cases against a theokit agent definition and read a verdict per case.
 *
 * This is a layer over the SDK's `Eval` runner, not a second runner (ADR D1): the SDK runs each case,
 * scores it and isolates its failure; this module builds each case's agent through
 * {@link toAgentFactory}, disposes what it built, and maps every returned row to `pass`, `fail` or
 * `error`.
 *
 * `error` means nobody measured the answer: the run did not finish, a guard stopped the turn, the
 * factory threw, or a scorer broke or returned something that is not a finite score (ADR D2). Such a
 * case is never counted as `fail`, which would tell the caller the agent answered badly.
 */

import { TheokitAgentError } from '@theokit/sdk/errors'
import {
  Eval,
  type DatasetEntry,
  type EvalOptions,
  type EvalRowResult,
  type NamedScorer,
  type Scorer,
} from '@theokit/sdk/eval'

import type { ApprovalPosture } from '../bridge/approval-posture.js'
import type { DefinitionOrThunk } from '../bridge/definition-or-thunk.js'
import {
  toAgentFactory,
  type RuntimeOverrides,
  type SdkAgentHandle,
} from '../bridge/sdk-adapter.js'

/** One input the caller wants checked; the SDK calls it a dataset entry. */
export interface AgentEvalCase {
  input: string
  expected?: unknown
}

/** This layer's answer for one case. */
export type AgentEvalVerdict = 'pass' | 'fail' | 'error'

export interface AgentEvalCaseResult {
  index: number
  input: string
  expected?: unknown
  output: string
  verdict: AgentEvalVerdict
  meanScore: number
  scores: readonly { readonly name: string; readonly score: number; readonly reason?: string }[]
  /** Why the case is an `error`; absent on `pass` and `fail`. */
  error?: string
  durationMs: number
}

export interface AgentEvalResult {
  name: string
  threshold: number
  cases: AgentEvalCaseResult[]
  counts: { pass: number; fail: number; error: number }
}

export interface RunAgentEvalsOptions {
  /** The definition under test, or a per-session thunk that returns one. */
  agent: DefinitionOrThunk
  apiKey: string | (() => string | Promise<string>)
  /** Mandatory, as on {@link toAgentFactory}: what a gated tool's approval request gets (ADR D3). */
  approvals: ApprovalPosture
  cases: readonly AgentEvalCase[]
  scorers: readonly (Scorer | NamedScorer)[]
  /** A case passes when its mean score is at or above this. Within [0, 1]; default 0.5. */
  threshold?: number
  /** The SDK run's name. Default `theokit-agent-evals-<uuid>`, so unnamed runs never collide (ADR D4). */
  name?: string
  overrides?: RuntimeOverrides
}

/** A configuration `runAgentEvals` refuses before it builds any agent. */
export class EvalConfigError extends TheokitAgentError {
  override readonly name = 'EvalConfigError'

  constructor(message: string) {
    // Not retryable: the same options are refused on every call.
    super(`[@theokit/agents] ${message}`, { code: 'eval_config_invalid', isRetryable: false })
  }
}

const DEFAULT_THRESHOLD = 0.5
const SCORER_THREW = 'scorer_threw:'

export async function runAgentEvals(opts: RunAgentEvalsOptions): Promise<AgentEvalResult> {
  validate(opts)
  const name = opts.name ?? `theokit-agent-evals-${crypto.randomUUID()}`
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD
  const factory = toAgentFactory(opts.agent, {
    apiKey: opts.apiKey,
    approvals: opts.approvals,
    ...(opts.overrides === undefined ? {} : { overrides: opts.overrides }),
  })
  // One uuid per call: the SDK caches agents by session id, so a name reused across sequential runs
  // must still give every case a fresh agent (EC-1).
  const runId = crypto.randomUUID()
  const handles: SdkAgentHandle[] = []
  let caseNumber = 0
  const agentFor = async (): Promise<SdkAgentHandle> => {
    // Incremented before the first await, so concurrent rows never share an id.
    caseNumber += 1
    const handle = await factory(`${name}-${runId}-case-${String(caseNumber)}`)
    handles.push(handle)
    return handle
  }
  const scorers = opts.scorers.map(strictScorer)
  let rows: readonly EvalRowResult[]
  try {
    const run = await Eval.create({
      name,
      dataset: opts.cases,
      scorers,
      agent: asEvalAgentFactory(agentFor),
    }).run()
    rows = run.rows
  } catch (runError) {
    // Every agent is still released, and the run's own error is the one reported.
    await Promise.allSettled(handles.map((h) => h.dispose()))
    throw runError
  }
  // The SDK never disposes an agent it got from a function, so the layer that built them does.
  await Promise.all(handles.map((h) => h.dispose()))
  const cases = rows.map((row) => toCaseResult(row, threshold))
  return { name, threshold, cases, counts: countVerdicts(cases) }
}

function validate(opts: RunAgentEvalsOptions): void {
  if (!Array.isArray(opts.cases) || opts.cases.length === 0) {
    throw new EvalConfigError('runAgentEvals: cases must be a non-empty array')
  }
  opts.cases.forEach((c, i) => {
    const entry: unknown = c
    const input =
      typeof entry === 'object' && entry !== null ? (entry as { input?: unknown }).input : undefined
    if (typeof input !== 'string') {
      throw new EvalConfigError(
        `runAgentEvals: cases[${String(i)}].input must be a string, got ${typeof input}`,
      )
    }
  })
  if (!Array.isArray(opts.scorers) || opts.scorers.length === 0) {
    throw new EvalConfigError('runAgentEvals: scorers must be a non-empty array')
  }
  const t = opts.threshold
  if (t !== undefined && !(Number.isFinite(t) && t >= 0 && t <= 1)) {
    throw new EvalConfigError(`runAgentEvals: threshold must be within [0, 1], got ${String(t)}`)
  }
}

/**
 * Wrap a caller's scorer so anything that is not a finite score THROWS inside the SDK's try, where it
 * becomes `scorer_threw: …` and so an `error` (ADR D2). Unwrapped, the SDK's `clampScore` turns a
 * non-finite score into 0 and keeps the scorer's own reason, which no verdict can tell from a real
 * 0, and a scorer returning `undefined` makes it throw outside the try and reject the whole run.
 * The name is the one the SDK itself would give: a `NamedScorer` keeps its own, a plain function is
 * `scorer-<index>`.
 */
function strictScorer(scorer: Scorer | NamedScorer, index: number): NamedScorer {
  const name = typeof scorer === 'function' ? `scorer-${String(index)}` : scorer.name
  const score = typeof scorer === 'function' ? scorer : scorer.score
  return {
    name,
    score: async (output: string, expected?: unknown) => {
      const result: unknown = await score(output, expected)
      if (!isFiniteScore(result)) {
        throw new Error(
          `scorer ${name} returned ${describeScore(result)}, not { score: finite number }`,
        )
      }
      return result
    },
  }
}

function isFiniteScore(value: unknown): value is { score: number; reason?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Number.isFinite((value as { score?: unknown }).score)
  )
}

function describeScore(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'score' in value) {
    return String(value.score)
  }
  return String(value)
}

/**
 * The one cast in this module. `EvalOptions.agent` is typed to return the SDK's full `SDKAgent`
 * (`model`, `close`, `reload`, …), which `SdkAgentHandle` is not; the runner's function-agent path
 * calls only `send(input)` and then `wait()` on the turn, and the handle provides both. The
 * integration tests drive the REAL runner with handles built by `toAgentFactory`, so a runner that
 * starts calling another member turns them red instead of a verdict wrong.
 */
function asEvalAgentFactory(agentFor: () => Promise<SdkAgentHandle>): EvalAgentFactory {
  return agentFor as unknown as EvalAgentFactory
}

/** The function shape of `EvalOptions.agent`, the one this module hands the runner. */
type EvalAgentFactory = Extract<EvalOptions['agent'], (entry: DatasetEntry) => unknown>

function toCaseResult(row: EvalRowResult, threshold: number): AgentEvalCaseResult {
  const error = row.error ?? row.scores.find((s) => s.reason?.startsWith(SCORER_THREW))?.reason
  return {
    index: row.index,
    input: row.input,
    ...(row.expected === undefined ? {} : { expected: row.expected }),
    output: row.output,
    verdict: verdictOf(error, row.meanScore, threshold),
    meanScore: row.meanScore,
    scores: row.scores,
    ...(error === undefined ? {} : { error }),
    durationMs: row.durationMs,
  }
}

function verdictOf(
  error: string | undefined,
  meanScore: number,
  threshold: number,
): AgentEvalVerdict {
  if (error !== undefined) return 'error'
  return meanScore >= threshold ? 'pass' : 'fail'
}

function countVerdicts(cases: readonly AgentEvalCaseResult[]): AgentEvalResult['counts'] {
  const counts = { pass: 0, fail: 0, error: 0 }
  for (const c of cases) counts[c.verdict] += 1
  return counts
}
