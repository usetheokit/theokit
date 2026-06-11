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
  const content = msg.content as unknown[] | undefined
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
  const status = msg.status as string
  if (status === 'completed') {
    return [
      {
        type: 'tool_result',
        callId: asString(msg.id, `tc-${Date.now()}`),
        toolName: asString(msg.name, 'unknown'),
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
        callId: asString(msg.id, `tc-${Date.now()}`),
        toolName: asString(msg.name, 'unknown'),
        output: asString(msg.error, 'Tool failed'),
        durationMs: 0,
        isError: true,
      },
    ]
  }
  return [] // 'running' status → no event (in progress)
}

function translateStatusEvent(msg: SdkMessage): StreamEvent[] {
  const s = msg.status as string
  if (s === 'done' || s === 'completed') {
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
  if (s === 'error') {
    return [
      {
        type: 'error',
        code: 'AGENT_ERROR',
        message: asString(msg.error, 'Agent error'),
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
      return [{ type: 'thinking', content: asString(msg.content, '') }]
    case 'status':
      return translateStatusEvent(msg)
    default:
      return [] // Unknown message types silently ignored
  }
}
