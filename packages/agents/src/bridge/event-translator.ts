/**
 * Translates @theokit/sdk SDKMessage events → TheoKit AgentStreamEvent.
 *
 * The SDK yields SDKMessage (system/assistant/tool_call/thinking/status).
 * TheoKit devtools + SSE handler expect AgentStreamEvent (run_started/text_delta/tool_call/done).
 * This module bridges the two — Adapter pattern (per sdk-integration-blueprint ADR-D2).
 */
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
        output: asString(msg.result, ''),
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
        output: asString(msg.result, 'Tool failed'),
        durationMs: 0,
        isError: true,
      },
    ]
  }
  return [] // 'running' status → no event (in progress)
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
