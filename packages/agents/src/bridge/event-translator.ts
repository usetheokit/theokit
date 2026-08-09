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
        // #138 — this was `tc-${Date.now()}`. A fresh id on every call is NEVER in the dedup set, so
        // the fallback defeated dedup by construction — and still looked like a real id to a reader.
        // An empty string is honest: `isDuplicatedByDelta` treats it as "I cannot identify this" and
        // prefers a visible double render to a silent suppression.
        callId: b.id ?? '',
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
  // #138 — likewise: without a `call_id` the identity is unknown, and a timestamp only disguises that.
  const callId = asString(msg.call_id, '')
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
 * #141 — DELIBERATE silence is legitimate; silence out of IGNORANCE is not.
 *
 * Both `default` branches in this file returned `[]` with an "ignored" comment, conflating two very
 * different things: types we decided not to expose (`token-delta`, `step-*` — high-frequency noise)
 * and types we simply did not know about (`request`, `task`, `ShellOutputDelta`). The second case is
 * what the fail-loud rule forbids: a pending-approval signal vanishing without a trace is
 * indistinguishable from "there was no signal".
 *
 * The explicit list separates the two. What is in it vanishes silently, because somebody decided so;
 * what is not warns ONCE per type — enough to show up in a diagnostic, without flooding a stream that
 * emits thousands of events per turn.
 */
const alreadyWarned = new Set<string>()

function warnIfUnknown(type: string, ignoradosDeProposito: ReadonlySet<string>): void {
  if (ignoradosDeProposito.has(type) || alreadyWarned.has(type)) return
  alreadyWarned.add(type)
  console.warn(
    `[theokit] agents.bridge: SDK event "${type}" is not translated and was discarded. ` +
      `If it carries information the UI needs, the translator needs a case for it (#141).`,
  )
}

/** `SDKMessage` types we decided NOT to expose — the silence here is a choice, not an oversight. */
const SDK_MESSAGE_IGNORED: ReadonlySet<string> = new Set(['user'])

/** High-frequency `InteractionUpdate` types the UI does not consume. */
const INTERACTION_UPDATE_IGNORED: ReadonlySet<string> = new Set([
  'thinking-completed',
  'token-delta',
  'step-started',
  'step-completed',
])

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
    case 'request':
      // theokit#141 — the pause signal. Only `request_id` is available (`SDKRequestMessage`), so it
      // becomes its own event rather than a synthesized `approval_required`: that one drives an
      // actionable UI and needs a tool name, a question and a callback URL, none of which exist
      // here. An approval prompt the user cannot answer is worse than an honest "waiting".
      return [{ type: 'input_requested', requestId: asString(msg.request_id, '') }]
    case 'task': {
      // theokit#141 — milestones/summaries. Both fields are optional upstream; an event carrying
      // neither costs a frame and tells the consumer nothing, so it is not emitted.
      const status = typeof msg.status === 'string' ? msg.status : undefined
      const text = typeof msg.text === 'string' ? msg.text : undefined
      if (status === undefined && text === undefined) return []
      return [
        {
          type: 'task_progress',
          ...(status !== undefined ? { status } : {}),
          ...(text !== undefined ? { text } : {}),
        },
      ]
    }
    default:
      // `msg.type` is already `string` on `SdkMessage`; the wrapper was a no-op the lint rejects.
      warnIfUnknown(msg.type, SDK_MESSAGE_IGNORED)
      return []
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
    case 'shell-output-delta':
      // theokit#141 — live shell output. Passed through opaquely: the SDK types the payload as
      // `Record<string, unknown>`, so any shape this layer assumed would be a second, weaker oracle
      // over a contract that lives upstream. What it must NOT be is `text_delta` — that would
      // splice command output into the assistant message the consumer persists as the transcript.
      return [{ type: 'shell_output', event: update.event }]
    default:
      // Same as above: the union's discriminant is already `string`.
      warnIfUnknown(update.type, INTERACTION_UPDATE_IGNORED)
      return []
  }
}
