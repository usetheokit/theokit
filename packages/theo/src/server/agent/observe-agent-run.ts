/**
 * Translate an agent's wire-chunk stream into spans (M8, usetheokit/theokit#353).
 *
 * ## Why this lives here and not in the agent loop
 *
 * The obvious reading of M8 is "instrument the agent loop". That is unreachable:
 * `packages/agents` depends on `@theokit/presenter`, `@theokit/sdk`,
 * `@theokit/sdk-pty` and `@theokit/sdk-tools` — not on `theokit` — while
 * `ObservabilityAdapter` lives under `packages/theo/src/server/`. Instrumenting
 * the loop would mean inverting the package graph to get a telemetry type across.
 *
 * It does not need to. The agent already emits a canonical, target-agnostic wire
 * chunk stream, and every signal the milestone names is a chunk in it: `start`
 * and `finish` bracket the run, `tool-input-available` opens a tool call and
 * `tool-output-available` / `tool-output-error` close it, `tool-approval-request`
 * is the human-in-the-loop pause, and `finish` carries the token usage.
 *
 * The agent emits; the framework observes. That split is also what keeps
 * `three-target-parity.md` intact: the same events reach Tauri and a terminal
 * over the in-process path, so those targets get the same spans without a second
 * instrumenter each — which is exactly what instrumenting the loop would have
 * quietly broken.
 *
 * ## It must not change the stream
 *
 * Every chunk is forwarded unchanged. A translator that drops or reshapes one
 * breaks the client in order to instrument the server.
 */
import type {
  ObservabilityAdapter,
  SpanContextInput,
  SpanHandle,
} from '../observability/adapters/types.js'
import { newSpanId, newTraceId } from '../observability/trace-context-propagation.js'

import { closePauseSpan, registerPauseSpan } from './hitl-pause-spans.js'

export interface AgentRunSpanContext {
  /** The agent being run, as the attribute an operator will group by. */
  agent: string
  /** Optional session/thread id, when the caller has one. */
  sessionId?: string
  /**
   * The trace this run belongs to, when the caller already has one — the
   * `traceparent` of the request that started it, typically. Absent means the
   * run opens a trace of its own, which is correct for a run nothing else
   * triggered (a cron, a terminal session).
   *
   * Without this the run would always be a root, and an agent invoked from an
   * HTTP request would sit in a trace of its own next to the request that caused
   * it — two traces for one thing that happened.
   */
  traceId?: string
  /**
   * The caller's span inside {@link traceId} — the `traceparent`'s parent-id.
   *
   * Read only when `traceId` is also present: a parent from one trace pinned
   * inside another names a span the backend cannot resolve, which is worse than
   * no parent at all.
   *
   * Without it the run was a SECOND root of the caller's trace rather than a
   * child of the caller's span: the correlation held and the waterfall's shape
   * did not (usetheokit/theokit#385).
   */
  parentSpanId?: string
}

/** The chunk fields this reads. Deliberately structural: the wire schema is owned elsewhere. */
interface ObservedChunk {
  type?: string
  toolCallId?: string
  toolName?: string
  approvalId?: string
  errorText?: string
  messageMetadata?: unknown
}

/**
 * The `finish` chunk's `messageMetadata` is an `AgentTurnMetadata`:
 * `{ usage: { inputTokens, outputTokens, totalTokens, ... }, cost?, durationMs }`
 * (`packages/agents/src/bridge/agent-stream-events.ts:141-146`). The tokens are
 * nested under `usage`, not flat on the metadata.
 *
 * This read them flat when it was first written, against a shape invented for the
 * test rather than read from the producer — so the span carried no token
 * attributes at all and the test agreed with it, because the fixture had the same
 * invented shape. Found by someone auditing the criteria, not by the suite. The
 * lesson is the one this codebase keeps re-learning: a test whose fixture comes
 * from the same assumption as the code cannot disagree with it.
 */
const TOKEN_FIELDS: [string, string][] = [
  ['inputTokens', 'tokens.input'],
  ['outputTokens', 'tokens.output'],
  ['totalTokens', 'tokens.total'],
  ['reasoningTokens', 'tokens.reasoning'],
  ['cacheReadTokens', 'tokens.cache_read'],
  ['cacheWriteTokens', 'tokens.cache_write'],
]

/**
 * usetheokit/theokit#379 — the stop reason, as the attribute an operator filters on.
 *
 * A run the SDK cut at its iteration ceiling (or stopped as a doom loop) still ends on `finish`, not
 * on an error, so without this attribute the trace of a truncated run is identical to the trace of a
 * finished one. That is the same blindness the issue reports one layer out, and the span is the
 * consumer that suffers it longest: nobody re-reads a stream, everybody re-reads a trace.
 *
 * The span status stays `ok`. A reached ceiling is a declared outcome, not a failure — calling it an
 * error would put every capped run in an operator's error budget.
 *
 * Only the two values the producer can emit are recorded. An unknown string is ignored rather than
 * passed through: the attribute is what a dashboard groups by, and a typo'd or hostile value would
 * silently create a new bucket.
 */
const STOP_REASONS = new Set(['step_limit', 'no_progress'])

/**
 * The model that ran, under the name the OpenTelemetry GenAI semantic
 * conventions give it — B-019's fifth criterion, and J9's criterion 5.
 *
 * ## Why the run span needs it at all
 *
 * The span already carries `tokens.input` / `tokens.output` / `tokens.total`,
 * and `cost.usd` when the provider reported one. When the provider does not,
 * tokens are the only route to "what did this run cost" — and tokens without a
 * model id convert to nothing, because price is per model. So a complete token
 * record answered the cost question for exactly the providers that had already
 * answered it.
 *
 * ## Why this spelling and not one of ours
 *
 * `gen_ai.request.model` — "the name of the GenAI model a request is being made
 * to" — is the registry entry in OpenTelemetry's GenAI semantic conventions
 * (`open-telemetry/semantic-conventions-genai`,
 * `docs/registry/attributes/gen-ai.md`), and it is what the AI SDK's
 * OpenTelemetry integration emits for the same fact. The value here is the model
 * the run was STARTED with, which is the request side, not
 * `gen_ai.response.model` (what the provider says answered) — that one is not on
 * the wire and inventing it from this would be a guess wearing a spec's name.
 *
 * A name of our own would have cost nothing to write and would not have been
 * readable by a single dashboard, processor or cost tool that already knows this
 * one.
 */
const GEN_AI_REQUEST_MODEL = 'gen_ai.request.model'

/**
 * The effective model id, read off the `finish` chunk's metadata.
 *
 * It arrives on the wire rather than from `CompiledAgentOptions.model` for two
 * reasons, and the second is the one that matters. The declared model is not
 * always the model: a per-run override wins over it, and an agent that declares
 * none still runs one (the adapter's own default). And the wire is the only path
 * the in-process targets share — a value read from the compiled agent inside the
 * HTTP route would be recorded for the served path and absent for Tauri and the
 * TUI, which is the split `three-target-parity.md` exists to prevent.
 */
function recordModel(span: SpanHandle, metadata: unknown): void {
  if (metadata === null || typeof metadata !== 'object') return
  const model = (metadata as { model?: unknown }).model
  if (typeof model === 'string' && model.length > 0) span.setAttribute(GEN_AI_REQUEST_MODEL, model)
}

function recordStopReason(span: SpanHandle, metadata: unknown): void {
  if (metadata === null || typeof metadata !== 'object') return
  const reason = (metadata as { stopReason?: unknown }).stopReason
  if (typeof reason === 'string' && STOP_REASONS.has(reason)) {
    span.setAttribute('stop.reason', reason)
  }
}

function recordTokenUsage(span: SpanHandle, metadata: unknown): void {
  if (metadata === null || typeof metadata !== 'object') return
  const bag = metadata as { usage?: unknown; cost?: unknown }

  if (typeof bag.cost === 'number') span.setAttribute('cost.usd', bag.cost)

  const usage = bag.usage
  if (usage === null || usage === undefined || typeof usage !== 'object') return
  const fields = usage as Record<string, unknown>
  for (const [field, attribute] of TOKEN_FIELDS) {
    const value = fields[field]
    if (typeof value === 'number') span.setAttribute(attribute, value)
  }
}

/** Spans open for one run, plus the names needed to label a pause. */
interface RunSpans {
  run: SpanHandle
  tools: Map<string, SpanHandle>
  /** toolCallId → approvalId. The span itself lives in `hitl-pause-spans.ts` (B-028). */
  pauses: Map<string, string>
  toolNames: Map<string, string>
  agent: string
  /**
   * The trace every span of this run belongs to, and the run span they hang
   * under. Held here because the `SpanHandle` an adapter returns exposes no
   * identity — parentage is decided by the code that opens both spans, which is
   * this file, and passed in (usetheokit/theokit#368).
   */
  traceId: string
  runSpanId: string
}

/** Where a child span of this run sits: same trace, under the run span. */
function childOf(state: RunSpans): { traceId: string; parentSpanId: string } {
  return { traceId: state.traceId, parentSpanId: state.runSpanId }
}

function openToolSpan(state: RunSpans, adapter: ObservabilityAdapter, chunk: ObservedChunk): void {
  const id = chunk.toolCallId
  if (id === undefined) return
  const tool = chunk.toolName ?? 'unknown'
  state.toolNames.set(id, tool)
  state.tools.set(
    id,
    adapter.startSpan('agent.tool', { agent: state.agent, tool, toolCallId: id }, childOf(state)),
  )
}

function openPauseSpan(state: RunSpans, adapter: ObservabilityAdapter, chunk: ObservedChunk): void {
  const id = chunk.toolCallId
  const approvalId = chunk.approvalId
  if (id === undefined || approvalId === undefined) return
  const pauseSpan = adapter.startSpan(
    'agent.hitl',
    {
      agent: state.agent,
      tool: state.toolNames.get(id) ?? 'unknown',
      approvalId,
      toolCallId: id,
    },
    childOf(state),
  )
  state.pauses.set(id, approvalId)
  // Handed to the registry both sides reach: the resume arrives on the approve endpoint, which this
  // observer never sees (B-028).
  registerPauseSpan(approvalId, pauseSpan)
}

function closeToolSpan(state: RunSpans, chunk: ObservedChunk): void {
  const id = chunk.toolCallId
  if (id === undefined) return

  // FALLBACK, and no longer the normal path (B-028). "The tool producing output IS the resume" was
  // this file's stated premise, and it was wrong by the model's post-resume latency — measured at
  // +1523 ms on a run whose human answered at 3306 ms. The approve endpoint now closes the span at
  // the instant the human answers; this closes it for transports that settle an approval without
  // one, the terminal prompt among them. `closePauseSpan` drops the handle on close, so whichever
  // arrives second cannot overwrite a duration the first got right.
  const pausedApprovalId = state.pauses.get(id)
  if (pausedApprovalId !== undefined) {
    closePauseSpan(pausedApprovalId, { resumeObserved: true })
    state.pauses.delete(id)
  }

  const span = state.tools.get(id)
  if (span === undefined) return
  if (chunk.type === 'tool-output-error') span.setStatus('error', chunk.errorText)
  else span.setStatus('ok')
  span.end()
  state.tools.delete(id)
}

export async function* observeAgentRun<T>(
  chunks: AsyncIterable<T>,
  adapter: ObservabilityAdapter,
  context: AgentRunSpanContext,
): AsyncIterable<T> {
  const runAttributes: Record<string, string> = { agent: context.agent }
  if (context.sessionId !== undefined) runAttributes.sessionId = context.sessionId

  // Minted before the run span so the id can be pinned and then named as parent
  // by every tool and pause span below.
  const traceId = context.traceId ?? newTraceId()
  const runSpanId = newSpanId()
  const runContext: SpanContextInput =
    context.traceId !== undefined && context.parentSpanId !== undefined
      ? { traceId, spanId: runSpanId, parentSpanId: context.parentSpanId }
      : { traceId, spanId: runSpanId }

  const state: RunSpans = {
    run: adapter.startSpan('agent.run', runAttributes, runContext),
    tools: new Map(),
    pauses: new Map(),
    toolNames: new Map(),
    agent: context.agent,
    traceId,
    runSpanId,
  }
  let settled = false

  /**
   * Close everything still open. Runs on success, on failure, and on a consumer
   * that stops reading — a client disconnect mid-run would otherwise leave the
   * run span open for the life of the process, which is the one case where the
   * leak and the operator's interest coincide.
   */
  function closeAll(status: 'ok' | 'error', message?: string): void {
    if (settled) return
    settled = true
    for (const approvalId of state.pauses.values()) {
      // A pause span reaching the sweep was never observed to resume, so its
      // duration approximates the whole run rather than the time a human took.
      // Saying so is not a nicety: an operator reading a four-minute pause span
      // has no other way to tell "the human thought for four minutes" from "we
      // never saw the resume".
      //
      // This is the EXCEPTIONAL path again. It was the normal one while the
      // approval chunk and the tool result carried different ids for the same
      // logical call and `closeToolSpan` could never match the pause
      // (usetheokit/theokit#361, fixed in `hitl-call-correlation.ts`). What still
      // reaches it is a pause that genuinely never resumed: the client
      // disconnected while a human was deciding, the approval timed out into an
      // aborted run, or the stream failed mid-pause.
      closePauseSpan(approvalId, { resumeObserved: false })
    }
    for (const span of state.tools.values()) {
      span.setStatus(status, message)
      span.end()
    }
    state.pauses.clear()
    state.tools.clear()
    state.run.setStatus(status, message)
    state.run.end()
  }

  try {
    for await (const chunk of chunks) {
      const observed = chunk as ObservedChunk

      if (observed.type === 'tool-input-available') openToolSpan(state, adapter, observed)
      else if (observed.type === 'tool-approval-request') openPauseSpan(state, adapter, observed)
      else if (observed.type === 'tool-output-available' || observed.type === 'tool-output-error')
        closeToolSpan(state, observed)
      else if (observed.type === 'finish') {
        recordTokenUsage(state.run, observed.messageMetadata)
        recordStopReason(state.run, observed.messageMetadata)
        recordModel(state.run, observed.messageMetadata)
      }

      yield chunk
    }
    closeAll('ok')
  } catch (error) {
    closeAll('error', error instanceof Error ? error.message : 'unknown error')
    throw error
  } finally {
    // Reached when the consumer abandons the iterator — `return()` runs the
    // `finally` without the `try` block completing.
    closeAll('error', 'agent run stream abandoned by its consumer')
  }
}
