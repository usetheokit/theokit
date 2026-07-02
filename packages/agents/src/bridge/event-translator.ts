/**
 * Translates @theokit/sdk SDKMessage events → TheoKit AgentStreamEvent.
 *
 * The SDK yields SDKMessage (system/assistant/tool_call/thinking/status).
 * TheoKit devtools + SSE handler expect AgentStreamEvent (run_started/text_delta/tool_call/done).
 * This module bridges the two — Adapter pattern (per sdk-integration-blueprint ADR-D2).
 */
import type { InteractionUpdate } from '@theokit/sdk'

import type { StreamEvent } from './agent-sse-handler.js'

/** Minimal SDK message shape — duck-typed to avoid hard import of @theokit/sdk types. */
export interface SdkMessage {
  type: string
  [key: string]: unknown
}

/** Safely coerce unknown value to string. */
function asString(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  return fallback
}

/**
 * Serialize a tool's `result` into the `string` wire contract of ToolResultEvent.output (#41).
 * String passthrough; null/undefined → fallback; otherwise JSON (String() on throw — BigInt/circular).
 */
function serializeToolOutput(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return fallback
  try {
    return JSON.stringify(value)
  } catch {
    // JSON.stringify throws on BigInt and circular refs. Preserve a BigInt's real value;
    // for anything non-serializable (circular object) base-to-string is uninformative, so
    // return the fallback rather than '[object Object]'.
    return typeof value === 'bigint' ? value.toString() : fallback
  }
}

function translateSystemEvent(msg: SdkMessage, runId: string): StreamEvent[] {
  return [
    {
      type: 'run_started',
      runId,
      agentName: asString(msg.agent_id, 'agent'),
      model: asString(msg.model, 'unknown'),
    },
  ]
}

function translateAssistantEvent(msg: SdkMessage): StreamEvent[] {
  const events: StreamEvent[] = []
  // Real SDKAssistantMessage (messages.ts:58): content lives at msg.message.content.
  const message = msg.message as { content?: unknown } | undefined
  const content = message?.content
  if (!Array.isArray(content)) return events

  for (const block of content) {
    const b = block as { type: string; text?: string; name?: string; input?: unknown; id?: string }
    if (b.type === 'text' && b.text) {
      events.push({ type: 'text_delta', content: b.text })
    }
    if (b.type === 'tool_use') {
      events.push({
        type: 'tool_call',
        callId: b.id ?? `tc-${Date.now()}`,
        toolName: b.name ?? 'unknown',
        input: b.input ?? {},
      })
    }
  }
  return events
}

function translateToolCallEvent(msg: SdkMessage): StreamEvent[] {
  // Real SDKToolUseMessage (messages.ts:89): call_id (not id), status running|completed|error,
  // tool output in `result` (no separate `error` field).
  const status = msg.status as string
  const callId = asString(msg.call_id, `tc-${Date.now()}`)
  const toolName = asString(msg.name, 'unknown')
  if (status === 'completed') {
    return [
      {
        type: 'tool_result',
        callId,
        toolName,
        output: serializeToolOutput(msg.result, ''),
        durationMs: 0,
        isError: false,
      },
    ]
  }
  if (status === 'error') {
    return [
      {
        type: 'tool_result',
        callId,
        toolName,
        output: serializeToolOutput(msg.result, 'Tool failed'),
        durationMs: 0,
        isError: true,
      },
    ]
  }
  if (status === 'running') {
    // #42: emit a tool_call at tool start so the UI shows the running card with its args.
    // theokit#58: the real SDKToolUseMessage carries the args in `args` (run-D22b53SU.d.ts:486;
    // live TC-DIAG confirmed `args={"command":…}`); `input`/`arguments` were never the SDK field
    // and resolved to `{}`, blanking the tool card. Read `args` first, keep the others as
    // defensive cross-shape fallbacks (error-handling.md).
    return [
      { type: 'tool_call', callId, toolName, input: msg.args ?? msg.input ?? msg.arguments ?? {} },
    ]
  }
  return [] // unknown status → no event
}

function translateStatusEvent(msg: SdkMessage): StreamEvent[] {
  // Real SDKStatusMessage (messages.ts:106): status is UPPERCASE cloud-run lifecycle;
  // error text (when present) is in `msg.message`. FINISHED/CANCELLED are terminal-clean;
  // ERROR/EXPIRED are terminal-failure (must surface — fail-loud, Unbreakable Rule 8);
  // CREATING/RUNNING are in-progress.
  const s = msg.status as string
  if (s === 'FINISHED' || s === 'CANCELLED') {
    return [
      {
        type: 'done',
        result: '',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        durationMs: 0,
        cost: 0,
      },
    ]
  }
  if (s === 'ERROR' || s === 'EXPIRED') {
    return [
      {
        type: 'error',
        code: 'AGENT_ERROR',
        message: asString(msg.message, 'Agent error'),
        retryable: false,
      },
    ]
  }
  return []
}

/**
 * Translate a single SDK message to zero or more TheoKit stream events.
 * Returns an array because one SDK message may map to multiple TheoKit events.
 */
export function translateSdkEvent(msg: SdkMessage, runId: string): StreamEvent[] {
  switch (msg.type) {
    case 'system':
      return translateSystemEvent(msg, runId)
    case 'assistant':
      return translateAssistantEvent(msg)
    case 'tool_call':
      return translateToolCallEvent(msg)
    case 'thinking':
      // Real SDKThinkingMessage (messages.ts:73): reasoning text is in msg.text.
      return [{ type: 'thinking', content: asString(msg.text, '') }]
    case 'status':
      return translateStatusEvent(msg)
    default:
      return [] // Unknown message types silently ignored
  }
}

/**
 * #44 — Translate ONE real-time `onDelta` `InteractionUpdate` to zero or more StreamEvents, in
 * arrival order. This is the chronological path: routing `tool-call-started/completed` (and
 * `thinking-delta`) through `onDelta` — alongside `text-delta` — keeps tool/text/thinking
 * interleaved in true model order, instead of all-text-then-all-tools (the run.stream() buffer is
 * post-completion). Shapes per @theokit/sdk types/updates.ts: `ToolCall { callId, name, args?, result? }`.
 * `partial-tool-call` is surfaced as a DISTINCT `partial_tool_call` event (theokit-sdk#70) so
 * consumers can stream tool-input; it never duplicates `tool_call` (different lifecycle points).
 * Reuses `serializeToolOutput` for the tool-result `output` wire contract (#41 / DRY).
 */
export function translateInteractionUpdate(update: InteractionUpdate): StreamEvent[] {
  switch (update.type) {
    case 'text-delta':
      return update.text ? [{ type: 'text_delta', content: update.text }] : []
    case 'thinking-delta':
      return update.text ? [{ type: 'thinking', content: update.text }] : []
    case 'tool-call-started':
      return [
        {
          type: 'tool_call',
          callId: update.callId,
          toolName: update.toolCall.name,
          input: update.toolCall.args ?? {},
        },
      ]
    case 'partial-tool-call':
      // theokit-sdk#70 — surface the incremental args so consumers can stream tool-input.
      // A DISTINCT event type (not another `tool_call`): the partial fills the arg-streaming
      // window that `tool-call-started` (args committed) closes — it never duplicates `tool_call`.
      return [
        {
          type: 'partial_tool_call',
          callId: update.callId,
          toolName: update.toolCall.name,
          input: update.toolCall.args ?? {},
        },
      ]
    case 'tool-call-completed':
      return [
        {
          type: 'tool_result',
          callId: update.callId,
          toolName: update.toolCall.name,
          output: serializeToolOutput(update.toolCall.result, ''),
          durationMs: 0,
          isError: false,
        },
      ]
    default:
      return [] // thinking-completed, token-delta, step-*, etc. — not surfaced
  }
}
