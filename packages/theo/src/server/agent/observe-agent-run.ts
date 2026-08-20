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
import type { ObservabilityAdapter, SpanHandle } from '../observability/adapters/types.js'
import { newSpanId, newTraceId } from '../observability/trace-context-propagation.js'

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
  pauses: Map<string, SpanHandle>
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
  state.pauses.set(
    id,
    adapter.startSpan(
      'agent.hitl',
      {
        agent: state.agent,
        tool: state.toolNames.get(id) ?? 'unknown',
        approvalId,
        toolCallId: id,
      },
      childOf(state),
    ),
  )
}

function closeToolSpan(state: RunSpans, chunk: ObservedChunk): void {
  const id = chunk.toolCallId
  if (id === undefined) return

  // The tool producing output IS the resume: it is what "the human answered and
  // the run continued" looks like on the wire.
  state.pauses.get(id)?.end()
  state.pauses.delete(id)

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

  const state: RunSpans = {
    run: adapter.startSpan('agent.run', runAttributes, { traceId, spanId: runSpanId }),
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
    for (const span of state.pauses.values()) {
      // A pause span reaching the sweep was never observed to resume, so its
      // duration approximates the whole run rather than the time a human took.
      // Saying so is not a nicety: an operator reading a four-minute pause span
      // has no other way to tell "the human thought for four minutes" from "we
      // never saw the resume". Today that is the NORMAL case, not an edge one -
      // the approval chunk and the tool result carry different ids for the same
      // logical call, so `closeToolSpan` never matches the pause
      // (usetheokit/theokit#361).
      span.setAttribute('hitl.resume_observed', false)
      span.setStatus('error', 'HITL pause never observed to resume; duration is not the human wait')
      span.end()
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
