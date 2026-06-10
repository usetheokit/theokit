/**
 * Typed discriminated union for agent SSE stream events.
 *
 * Every event has a `type` field for discrimination.
 * Clients narrow via `if (event.type === 'text_delta') event.content`.
 */

/** Partial text content from the LLM. */
export interface TextDeltaEvent {
  type: 'text_delta'
  content: string
}

/** Agent started a tool call. */
export interface ToolCallEvent {
  type: 'tool_call'
  callId: string
  toolName: string
  input: unknown
}

/** Tool execution completed. */
export interface ToolResultEvent {
  type: 'tool_result'
  callId: string
  toolName: string
  output: string
  durationMs: number
  isError: boolean
}

/** Extended thinking / reasoning (when model supports it). */
export interface ThinkingEvent {
  type: 'thinking'
  content: string
}

/** Agent loop iteration. */
export interface IterationEvent {
  type: 'iteration'
  step: number
  totalSteps: number | null
}

/** Human approval required before proceeding. */
export interface ApprovalRequiredEvent {
  type: 'approval_required'
  callId: string
  toolName: string
  question: string
  input?: unknown
  callbackUrl: string
  timeoutMs: number
}

/** Agent encountered an error. */
export interface ErrorEvent {
  type: 'error'
  code: string
  message: string
  retryable: boolean
}

/** Agent completed with a final result. */
export interface DoneEvent {
  type: 'done'
  result: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  durationMs: number
  /** Total cost in USD for this agent run (EC-2: added for budget tracking). */
  cost?: number
}

/** Agent run started. */
export interface RunStartedEvent {
  type: 'run_started'
  runId: string
  agentName: string
  model?: string
}

/** Artifact generation started (code, document, diagram). */
export interface ArtifactStartEvent {
  type: 'artifact_start'
  artifactId: string
  mimeType: string
  filename?: string
  metadata?: Record<string, unknown>
}

/** Artifact content chunk (streamable artifacts). */
export interface ArtifactChunkEvent {
  type: 'artifact_chunk'
  artifactId: string
  chunk: string
  isLast: boolean
}

/** Real-time state update from @Observable channels. */
export interface StateUpdateEvent {
  type: 'state_update'
  channel: string
  data: unknown
}

/** Checkpoint saved (resumable agents). */
export interface CheckpointSavedEvent {
  type: 'checkpoint_saved'
  checkpointId: string
  step: number
  resumeToken: string
}

/** File edit produced by a code assistant tool. */
export interface FileEditEvent {
  type: 'file_edit'
  file: string
  format: 'search-replace' | 'unified-diff' | 'full-file' | 'line-range'
  search?: string
  replace?: string
  content?: string
  diff?: string
  startLine?: number
  endLine?: number
}

/** Discriminated union of all agent stream events. */
export type AgentStreamEvent =
  | RunStartedEvent
  | TextDeltaEvent
  | ToolCallEvent
  | ToolResultEvent
  | ThinkingEvent
  | IterationEvent
  | ApprovalRequiredEvent
  | ArtifactStartEvent
  | ArtifactChunkEvent
  | StateUpdateEvent
  | CheckpointSavedEvent
  | FileEditEvent
  | ErrorEvent
  | DoneEvent

/** Type guard helpers. */
export function isTextDelta(e: AgentStreamEvent): e is TextDeltaEvent { return e.type === 'text_delta' }
export function isToolCall(e: AgentStreamEvent): e is ToolCallEvent { return e.type === 'tool_call' }
export function isToolResult(e: AgentStreamEvent): e is ToolResultEvent { return e.type === 'tool_result' }
export function isDone(e: AgentStreamEvent): e is DoneEvent { return e.type === 'done' }
export function isError(e: AgentStreamEvent): e is ErrorEvent { return e.type === 'error' }
export function isApprovalRequired(e: AgentStreamEvent): e is ApprovalRequiredEvent { return e.type === 'approval_required' }
