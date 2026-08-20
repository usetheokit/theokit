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

export interface AgentRunSpanContext {
  /** The agent being run, as the attribute an operator will group by. */
  agent: string
  /** Optional session/thread id, when the caller has one. */
  sessionId?: string
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

const TOKEN_FIELDS: [string, string][] = [
  ['inputTokens', 'tokens.input'],
  ['outputTokens', 'tokens.output'],
  ['totalTokens', 'tokens.total'],
]

function recordTokenUsage(span: SpanHandle, metadata: unknown): void {
  if (metadata === null || typeof metadata !== 'object') return
  const bag = metadata as Record<string, unknown>
  for (const [field, attribute] of TOKEN_FIELDS) {
    const value = bag[field]
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
}

function openToolSpan(state: RunSpans, adapter: ObservabilityAdapter, chunk: ObservedChunk): void {
  const id = chunk.toolCallId
  if (id === undefined) return
  const tool = chunk.toolName ?? 'unknown'
  state.toolNames.set(id, tool)
  state.tools.set(id, adapter.startSpan('agent.tool', { agent: state.agent, tool, toolCallId: id }))
}

function openPauseSpan(state: RunSpans, adapter: ObservabilityAdapter, chunk: ObservedChunk): void {
  const id = chunk.toolCallId
  const approvalId = chunk.approvalId
  if (id === undefined || approvalId === undefined) return
  state.pauses.set(
    id,
    adapter.startSpan('agent.hitl', {
      agent: state.agent,
      tool: state.toolNames.get(id) ?? 'unknown',
      approvalId,
      toolCallId: id,
    }),
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

  const state: RunSpans = {
    run: adapter.startSpan('agent.run', runAttributes),
    tools: new Map(),
    pauses: new Map(),
    toolNames: new Map(),
    agent: context.agent,
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
    for (const span of state.pauses.values()) span.end()
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
      else if (observed.type === 'finish') recordTokenUsage(state.run, observed.messageMetadata)

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
