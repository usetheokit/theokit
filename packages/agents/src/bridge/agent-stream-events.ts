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

/**
 * Tool-call arguments streaming in incrementally (theokit-sdk#70). Emitted repeatedly as the
 * model generates a tool call's args, BEFORE they are committed. The same `callId` correlates to
 * the later `tool_call` (args committed) and `tool_result`. Consumers opt in to render tool-input
 * progressively; those that don't simply ignore this variant (it never replaces `tool_call`).
 */
export interface PartialToolCallEvent {
  type: 'partial_tool_call'
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
  /** M20 — JSON-schema descriptor of the custom payload the approver may attach (optional). */
  payloadSchema?: Record<string, unknown>
}

/**
 * The run is blocked awaiting user input or approval — theokit#141.
 *
 * The SDK's low-fidelity pause signal (`SDKRequestMessage`), distinct from {@link
 * ApprovalRequiredEvent}. The latter is the framework's own, produced by `createHitlPlugin`, and
 * carries everything an approval UI needs to be actionable. This one carries only the request id,
 * because that is all the SDK provides — and it matters most exactly where the plugin is absent
 * (the ACP/serving path of theokit#139), which is where a dropped pause reads to the user as a
 * hang with no explanation.
 *
 * A consumer that cannot resolve the request should still SHOW that the run is waiting. Silence is
 * the one response that is always wrong.
 */
export interface InputRequestedEvent {
  type: 'input_requested'
  requestId: string
}

/** Task-level milestone or summary — theokit#141. Both fields are optional at the source. */
export interface TaskProgressEvent {
  type: 'task_progress'
  status?: string
  text?: string
}

/**
 * Live output from a shell command the SDK is running — theokit#141.
 *
 * `event` is passed through opaquely because the SDK types it as `Record<string, unknown>`. The
 * layer deliberately does not interpret or render it: guessing a shape here would be a second,
 * weaker oracle over a payload whose real contract lives upstream.
 */
export interface ShellOutputEvent {
  type: 'shell_output'
  event: Record<string, unknown>
}

/** Agent encountered an error. */
export interface ErrorEvent {
  type: 'error'
  code: string
  message: string
  retryable: boolean
}

/**
 * Why a run stopped short of finishing on its own — theokit#379.
 *
 * ## Why it is an enum and not a `truncated: boolean`
 *
 * The two members demand OPPOSITE reactions from the caller, and a boolean cannot carry the
 * difference:
 *
 *  - `'step_limit'` — the loop ran out of tool-calling turns while the model still wanted more.
 *    The work is unfinished but progressing; re-sending is the sane continuation.
 *  - `'no_progress'` — the doom-loop guard stopped the model repeating IDENTICAL tool calls. The
 *    SDK's own wording: "a controlled stop, NOT a truncation to re-send". Re-sending repeats the
 *    loop that was just cut.
 *
 * A caller that reads `truncated: true` and re-sends does the right thing in the first case and
 * feeds the doom loop in the second.
 *
 * ## Why these spellings
 *
 * Both sides of the boundary had already agreed on them before this field existed: the framework's
 * own `LoopFinishReason` (`../loop/loop-strategy.ts`) spells the outer-loop terminals `step_limit`
 * and `no_progress`, and so does the SDK's continuation driver
 * (`RunToCompletionResult.terminal: "done" | "step_limit" | "no_progress"`). Inventing a third
 * vocabulary for the same two outcomes was the only way to get this wrong.
 *
 * ## Why there is no `'finished'` member
 *
 * A clean run carries NO `stopReason` at all — absence is the finished case. Stamping every
 * ordinary turn with a new field would change what every existing consumer receives in order to
 * describe the one case that was already correct. A consumer that has never heard of `stopReason`
 * therefore keeps receiving byte-identical frames for every run that finishes on its own, and for a
 * truncated one it receives one extra optional key it ignores — the same degradation the ai-sdk
 * `finish` chunk already allows, since its `messageMetadata` is `unknown`.
 */
export type AgentStopReason = 'step_limit' | 'no_progress'

/** Agent completed with a final result. */
export interface DoneEvent {
  type: 'done'
  result: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
    /** V4-O: SDK reasoning/cache token buckets (0 when the provider omits them). */
    reasoningTokens?: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
  }
  durationMs: number
  /** Total cost in USD for this agent run (EC-2: added for budget tracking). */
  cost?: number
  /**
   * theokit#379 — why the run stopped, when it did NOT stop because the agent was done.
   *
   * ABSENT on a clean finish. Present only when the SDK reports that the run was cut: the terminal
   * frame is a `done` either way (a reached ceiling is not an error — see `sdk-adapter.ts`'s
   * `applyStepCeiling`), so without this field a cut run and a finished one are the same event.
   *
   * Read from `RunResult.stoppedByDoomLoop` / `RunResult.stoppedAtIterationLimit` at the adapter
   * boundary. See {@link AgentStopReason} for why the caller needs to tell the two apart.
   */
  stopReason?: AgentStopReason
}

/**
 * Per-turn usage the translator attaches to the ai-sdk `finish` chunk's `messageMetadata`, so it
 * lands on the reconstructed assistant `UIMessage.metadata` on the client (via `readUIMessageStream`)
 * with NO extra header/store wiring. It is the seam that lets a surface (a TUI status bar, a web
 * cost meter) show real tokens/cost for the turn it just streamed. Mirrors `DoneEvent`'s usage/cost
 * (the authoritative totals the SDK reports at turn end) plus the wall-clock `durationMs`.
 */
export interface AgentTurnMetadata {
  usage: DoneEvent['usage']
  /** Total cost in USD for the turn (present iff the SDK reported it). */
  cost?: number
  durationMs: number
  /**
   * theokit#379 — mirrors {@link DoneEvent.stopReason} so a surface that only ever sees the wire
   * (a web client reading `UIMessage.metadata`, the observability translator reading the `finish`
   * chunk) can tell a cut turn from a finished one without a second transport. Absent on a clean
   * finish, exactly as on `DoneEvent`.
   */
  stopReason?: AgentStopReason
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
  | PartialToolCallEvent
  | ToolResultEvent
  | ThinkingEvent
  | IterationEvent
  | ApprovalRequiredEvent
  | InputRequestedEvent
  | TaskProgressEvent
  | ShellOutputEvent
  | ArtifactStartEvent
  | ArtifactChunkEvent
  | StateUpdateEvent
  | CheckpointSavedEvent
  | FileEditEvent
  | ErrorEvent
  | DoneEvent

/** Type guard helpers. */
export function isTextDelta(e: AgentStreamEvent): e is TextDeltaEvent {
  return e.type === 'text_delta'
}
export function isToolCall(e: AgentStreamEvent): e is ToolCallEvent {
  return e.type === 'tool_call'
}
export function isPartialToolCall(e: AgentStreamEvent): e is PartialToolCallEvent {
  return e.type === 'partial_tool_call'
}
export function isToolResult(e: AgentStreamEvent): e is ToolResultEvent {
  return e.type === 'tool_result'
}
export function isDone(e: AgentStreamEvent): e is DoneEvent {
  return e.type === 'done'
}
export function isError(e: AgentStreamEvent): e is ErrorEvent {
  return e.type === 'error'
}
export function isApprovalRequired(e: AgentStreamEvent): e is ApprovalRequiredEvent {
  return e.type === 'approval_required'
}
