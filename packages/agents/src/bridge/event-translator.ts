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

/**
 * Translate a single SDK message to zero or more TheoKit stream events.
 * Returns an array because one SDK message may map to multiple TheoKit events.
 */
export function translateSdkEvent(msg: SdkMessage, runId: string): StreamEvent[] {
  switch (msg.type) {
    case 'system':
      return [{
        type: 'run_started',
        runId,
        agentName: (msg.agent_id as string) ?? 'agent',
        model: (msg.model as string) ?? 'unknown',
      }]

    case 'assistant': {
      const events: StreamEvent[] = []
      const content = msg.content as unknown[] | undefined
      if (Array.isArray(content)) {
        for (const block of content) {
          const b = block as { type: string; text?: string; name?: string; input?: unknown; id?: string }
          if (b.type === 'text' && b.text) {
            events.push({ type: 'text_delta', content: b.text })
          }
          if (b.type === 'tool_use') {
            events.push({ type: 'tool_call', callId: b.id ?? `tc-${Date.now()}`, toolName: b.name ?? 'unknown', input: b.input ?? {} })
          }
        }
      }
      return events
    }

    case 'tool_call': {
      const status = msg.status as string
      if (status === 'completed') {
        return [{
          type: 'tool_result',
          callId: (msg.id as string) ?? `tc-${Date.now()}`,
          toolName: (msg.name as string) ?? 'unknown',
          output: String(msg.result ?? ''),
          durationMs: 0,
          isError: false,
        }]
      }
      if (status === 'error') {
        return [{
          type: 'tool_result',
          callId: (msg.id as string) ?? `tc-${Date.now()}`,
          toolName: (msg.name as string) ?? 'unknown',
          output: String(msg.error ?? 'Tool failed'),
          durationMs: 0,
          isError: true,
        }]
      }
      return [] // 'running' status → no event (in progress)
    }

    case 'thinking':
      return [{ type: 'thinking', content: String(msg.content ?? '') }]

    case 'status': {
      const s = msg.status as string
      if (s === 'done' || s === 'completed') {
        return [{
          type: 'done',
          result: '',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: 0,
          cost: 0,
        }]
      }
      if (s === 'error') {
        return [{
          type: 'error',
          code: 'AGENT_ERROR',
          message: String(msg.error ?? 'Agent error'),
          retryable: false,
        }]
      }
      return []
    }

    default:
      return [] // Unknown message types silently ignored
  }
}
