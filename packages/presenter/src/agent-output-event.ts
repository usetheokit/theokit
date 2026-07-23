/**
 * `AgentOutputEvent` — the canonical, normalized agent-output event (M49).
 *
 * This is the **narrow waist** of theokit's presentation layer: ONE normalized event that every SOURCE
 * (the SDK's `SDKMessage` / `InteractionUpdate`) is translated INTO, and that every `Presenter`
 * (web `UIMessageStream`, terminal ANSI, JSON API) is translated OUT of. Without it you get N×M
 * translators — the current duplication where the web path and the terminal path each re-translate the
 * SDK independently and drift. The variants are derived from the SDK's own event discriminants (source
 * side), NOT from any single surface's wire format, so no surface leaks into the contract.
 *
 * @public
 */
export type AgentOutputEvent =
  | AgentTextEvent
  | AgentReasoningEvent
  | AgentToolCallEvent
  | AgentPartialToolCallEvent
  | AgentToolResultEvent
  | AgentErrorEvent
  | AgentFinishEvent
  | AgentStatusEvent

/** Assistant text output (streamed or whole). */
export interface AgentTextEvent {
  readonly type: 'text'
  readonly text: string
}

/** Model reasoning / thinking content (distinct from user-visible text). */
export interface AgentReasoningEvent {
  readonly type: 'reasoning'
  readonly text: string
}

/** A tool invocation with its (committed) input — the args the model decided on. */
export interface AgentToolCallEvent {
  readonly type: 'tool-call'
  readonly callId: string
  readonly name: string
  readonly input: unknown
}

/**
 * Incremental tool input as the model streams the args (theokit-sdk#70) — a DISTINCT lifecycle point
 * from `tool-call` (args committed). Consumers that stream tool-input render the progressive args; those
 * that don't may ignore it. Never duplicates `tool-call`.
 */
export interface AgentPartialToolCallEvent {
  readonly type: 'partial-tool-call'
  readonly callId: string
  readonly name: string
  readonly input: unknown
}

/** The result of a tool invocation, keyed by the same `callId`. `isError` marks a failed tool. */
export interface AgentToolResultEvent {
  readonly type: 'tool-result'
  readonly callId: string
  readonly name: string
  readonly result: unknown
  readonly isError?: boolean
}

/** A run-level error (typed message + optional code). */
export interface AgentErrorEvent {
  readonly type: 'error'
  readonly message: string
  readonly code?: string
}

/** Terminal event of a turn: the run finished. `usage` carries token accounting when available. */
export interface AgentFinishEvent {
  readonly type: 'finish'
  readonly reason?: string
  readonly usage?: { readonly totalTokens?: number }
}

/** A lifecycle status transition (e.g. goal `active` → `completed`), surface-agnostic. */
export interface AgentStatusEvent {
  readonly type: 'status'
  readonly status: string
  readonly detail?: string
}

/** The stable set of variant discriminants — useful for exhaustiveness and registry keys. */
export const AGENT_OUTPUT_EVENT_TYPES = [
  'text',
  'reasoning',
  'tool-call',
  'partial-tool-call',
  'tool-result',
  'error',
  'finish',
  'status',
] as const

export type AgentOutputEventType = (typeof AGENT_OUTPUT_EVENT_TYPES)[number]

// --- type guards (discriminate a canonical event without a manual `switch`) ---

export const isTextEvent = (e: AgentOutputEvent): e is AgentTextEvent => e.type === 'text'
export const isReasoningEvent = (e: AgentOutputEvent): e is AgentReasoningEvent =>
  e.type === 'reasoning'
export const isToolCallEvent = (e: AgentOutputEvent): e is AgentToolCallEvent =>
  e.type === 'tool-call'
export const isPartialToolCallEvent = (e: AgentOutputEvent): e is AgentPartialToolCallEvent =>
  e.type === 'partial-tool-call'
export const isToolResultEvent = (e: AgentOutputEvent): e is AgentToolResultEvent =>
  e.type === 'tool-result'
export const isErrorEvent = (e: AgentOutputEvent): e is AgentErrorEvent => e.type === 'error'
export const isFinishEvent = (e: AgentOutputEvent): e is AgentFinishEvent => e.type === 'finish'
export const isStatusEvent = (e: AgentOutputEvent): e is AgentStatusEvent => e.type === 'status'
