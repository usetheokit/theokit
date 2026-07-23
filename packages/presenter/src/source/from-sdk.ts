import type { InteractionUpdate } from '@theokit/sdk'

import type { AgentOutputEvent } from '../agent-output-event.js'

/**
 * `fromSdk` (M49) — the SINGLE source translator: `@theokit/sdk` output → the canonical
 * {@link AgentOutputEvent}. Every presenter (web / terminal / json) consumes the result, so the SDK is
 * parsed ONCE instead of each surface re-translating it (the duplication this layer removes).
 *
 * Ported faithfully from `@theokit/agents/bridge/event-translator.ts` (the proven web-path logic), but
 * emitting the NARROW pure-output event: framework concerns (run-lifecycle, HITL approval, checkpoints,
 * devtools artifacts) are NOT SDK output and are layered by `@theokit/agents` on top (ADR-4), so they are
 * intentionally NOT produced here.
 */

/** Minimal SDK message shape — duck-typed to avoid a hard import of every SDK message subtype. */
export interface SdkMessage {
  readonly type: string
  readonly [key: string]: unknown
}

/** Safely coerce an unknown value to a string, else the fallback. */
function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * Serialize a tool's `result` for the canonical `tool-result.result`. String passthrough; null/undefined →
 * fallback; otherwise JSON. `JSON.stringify` throws on BigInt / circular refs — preserve a BigInt's real
 * value, else fall back (never `[object Object]`). Mirrors event-translator's `serializeToolOutput` (#41).
 */
function serializeToolResult(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return fallback
  try {
    return JSON.stringify(value)
  } catch {
    return typeof value === 'bigint' ? value.toString() : fallback
  }
}

function fromAssistant(msg: SdkMessage): AgentOutputEvent[] {
  const events: AgentOutputEvent[] = []
  const content = (msg.message as { content?: unknown } | undefined)?.content
  if (!Array.isArray(content)) return events
  for (const block of content) {
    const b = block as { type: string; text?: string; name?: string; input?: unknown; id?: string }
    if (b.type === 'text' && b.text) events.push({ type: 'text', text: b.text })
    if (b.type === 'tool_use') {
      events.push({
        type: 'tool-call',
        callId: b.id ?? `tc-${Date.now()}`,
        name: b.name ?? 'unknown',
        input: b.input ?? {},
      })
    }
  }
  return events
}

function fromToolUse(msg: SdkMessage): AgentOutputEvent[] {
  const status = msg.status as string
  const callId = asString(msg.call_id, `tc-${Date.now()}`)
  const name = asString(msg.name, 'unknown')
  if (status === 'completed') {
    return [
      {
        type: 'tool-result',
        callId,
        name,
        result: serializeToolResult(msg.result, ''),
        isError: false,
      },
    ]
  }
  if (status === 'error') {
    return [
      {
        type: 'tool-result',
        callId,
        name,
        result: serializeToolResult(msg.result, 'Tool failed'),
        isError: true,
      },
    ]
  }
  if (status === 'running') {
    // Tool start — emit the committed call so the UI shows the running card. The SDK carries args in
    // `args` (theokit#58; `input`/`arguments` were never the field); keep the others as defensive fallbacks.
    return [
      { type: 'tool-call', callId, name, input: msg.args ?? msg.input ?? msg.arguments ?? {} },
    ]
  }
  return []
}

function fromStatus(msg: SdkMessage): AgentOutputEvent[] {
  // SDKStatusMessage: UPPERCASE cloud-run lifecycle. FINISHED/CANCELLED → finish (terminal-clean);
  // ERROR/EXPIRED → error (terminal-failure, fail-loud). CREATING/RUNNING → in-progress (no output).
  const s = msg.status as string
  if (s === 'FINISHED' || s === 'CANCELLED') return [{ type: 'finish', reason: s.toLowerCase() }]
  if (s === 'ERROR' || s === 'EXPIRED') {
    return [{ type: 'error', message: asString(msg.message, 'Agent error'), code: 'AGENT_ERROR' }]
  }
  return []
}

/** Translate ONE buffered SDK message (`run.stream()`) to zero or more canonical output events. */
export function fromSdkMessage(msg: SdkMessage): AgentOutputEvent[] {
  switch (msg.type) {
    case 'assistant':
      return fromAssistant(msg)
    case 'tool_call':
      return fromToolUse(msg)
    case 'thinking':
      return [{ type: 'reasoning', text: asString(msg.text, '') }]
    case 'status':
      return fromStatus(msg)
    // `system` / run-lifecycle is framework framing, not pure output — intentionally skipped (ADR-4).
    default:
      return []
  }
}

/**
 * Translate ONE real-time `onDelta` {@link InteractionUpdate} to zero or more canonical output events, in
 * arrival order — the chronological path that keeps text / tool / thinking interleaved in true model order.
 * `partial-tool-call` is surfaced distinctly (theokit-sdk#70); it never duplicates `tool-call`.
 */
export function fromInteractionUpdate(update: InteractionUpdate): AgentOutputEvent[] {
  switch (update.type) {
    case 'text-delta':
      return update.text ? [{ type: 'text', text: update.text }] : []
    case 'thinking-delta':
      return update.text ? [{ type: 'reasoning', text: update.text }] : []
    case 'tool-call-started':
      return [
        {
          type: 'tool-call',
          callId: update.callId,
          name: update.toolCall.name,
          input: update.toolCall.args ?? {},
        },
      ]
    case 'partial-tool-call':
      return [
        {
          type: 'partial-tool-call',
          callId: update.callId,
          name: update.toolCall.name,
          input: update.toolCall.args ?? {},
        },
      ]
    case 'tool-call-completed':
      return [
        {
          type: 'tool-result',
          callId: update.callId,
          name: update.toolCall.name,
          result: serializeToolResult(update.toolCall.result, ''),
          isError: false,
        },
      ]
    default:
      return []
  }
}
