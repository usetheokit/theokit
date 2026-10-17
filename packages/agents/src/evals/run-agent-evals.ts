/**
 * B-413 — run a list of cases against a theokit agent definition and read a verdict per case.
 *
 * This is a layer over the SDK's `Eval` runner, not a second runner (ADR D1): the SDK runs each case,
 * scores it and isolates its failure; this module builds each case's agent through
 * {@link toAgentFactory}, disposes what it built, and maps every returned row to `pass`, `fail` or
 * `error`.
 *
 * `error` means nobody measured the answer: the run did not finish, a guard stopped the turn, the
 * factory threw, or a scorer threw or returned something that is not a score within [0, 1] (ADR D2).
 * Such a case is never counted as `fail`, which would tell the caller the agent answered badly.
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
  // Marks a scorer failure in the reason this layer writes. It carries the run's uuid, so no scorer
  // can know it in advance and a caller's own reason can never be read as a failure.
  const failureMark = `theokit-scorer-failed-${runId}: `
  const scorers = opts.scorers.map((scorer, index) => strictScorer(scorer, index, failureMark))
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
  const cases = rows.map((row) => toCaseResult(row, threshold, failureMark))
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
 * Wrap a caller's scorer so a throw, or anything that is not a score within [0, 1], becomes a 0
 * whose reason starts with `failureMark`, and so an `error` (ADR D2). Unwrapped, the SDK's
 * `clampScore` turns 1.5 into 1 and -0.1 or a non-finite score into 0, which no verdict can tell
 * from a measured score, and a scorer returning `undefined` makes it throw outside its try and
 * reject the whole run. The wrapper never throws, so no verdict depends on how the SDK words a
 * scorer that did. The name is the one the SDK itself would give: a `NamedScorer` keeps its own, a
 * plain function is `scorer-<index>`.
 */
function strictScorer(
  scorer: Scorer | NamedScorer,
  index: number,
  failureMark: string,
): NamedScorer {
  const name = typeof scorer === 'function' ? `scorer-${String(index)}` : scorer.name
  const score = typeof scorer === 'function' ? scorer : scorer.score
  const failed = (why: string) => ({ score: 0, reason: `${failureMark}scorer ${name} ${why}` })
  return {
    name,
    score: async (output: string, expected?: unknown) => {
      let result: unknown
      try {
        result = await score(output, expected)
      } catch (scorerError) {
        return failed(
          `threw: ${scorerError instanceof Error ? scorerError.message : describe(scorerError)}`,
        )
      }
      if (!isUnitScore(result)) {
        return failed(`returned ${describeScore(result)}, not { score: number within [0, 1] }`)
      }
      return result
    },
  }
}

function isUnitScore(value: unknown): value is { score: number; reason?: string } {
  if (typeof value !== 'object' || value === null) return false
  const score = (value as { score?: unknown }).score
  return typeof score === 'number' && score >= 0 && score <= 1
}

function describeScore(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'score' in value) {
    return describe(value.score)
  }
  return describe(value)
}

/** `String()` throws on an object with no prototype; this never does. */
function describe(value: unknown): string {
  try {
    return String(value)
  } catch {
    // The value has no string form, and its type is all that can be said about it.
    return `a value of type ${typeof value} with no string form`
  }
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

function toCaseResult(
  row: EvalRowResult,
  threshold: number,
  failureMark: string,
): AgentEvalCaseResult {
  const scores = row.scores.map((s) =>
    s.reason?.startsWith(failureMark) === true
      ? { ...s, reason: s.reason.slice(failureMark.length) }
      : s,
  )
  const failure = row.scores.find((s) => s.reason?.startsWith(failureMark) === true)
  const error = row.error ?? failure?.reason?.slice(failureMark.length)
  return {
    index: row.index,
    input: row.input,
    ...(row.expected === undefined ? {} : { expected: row.expected }),
    output: row.output,
    verdict: verdictOf(error, row.meanScore, threshold),
    meanScore: row.meanScore,
    scores,
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
