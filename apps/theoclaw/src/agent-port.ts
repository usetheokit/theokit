import type { AgentStreamEvent, SdkMessage, SdkTimelineEvent } from '@theokit/agents/bridge'
import type { InteractionUpdate } from '@theokit/sdk'

/**
 * What TheoClaw needs of an agent, for both the chat replies and the `/control` turns: one
 * container builds the agents of both, so the port is declared once.
 *
 * The stream element is the narrow `{ type }`, not the presenter's or the bridge's `SdkMessage`:
 * those declare an index signature the SDK's message interfaces do not, so the SDK agent would
 * not be assignable to a port typed with them.
 *
 * There is no `close` here on purpose. The request boundary (`createContainer().withAgent`) disposes
 * the agent through `Symbol.asyncDispose` when the turn ends. In `@theokit/sdk` 5.11 `close()` only
 * marks the agent disposed, so calling it first makes that disposal return without tearing the
 * session down, and every turn would leak its agent session.
 */
/**
 * What one `send` carries: the text alone, or the text with images the model reads on that user
 * turn (the `computer` tool's screenshot, B-676 D1). The SDK agent accepts both shapes.
 */
export type TurnMessage =
  | string
  | {
      readonly text: string
      readonly images: { readonly data: string; readonly mimeType: string }[]
    }

export interface TurnAgent {
  /**
   * Start one run. `signal` stops the model work of that run: the SDK composes it into its dispatch
   * signal, where `run.cancel()` alone only moves the local run's status (B-376, plan D2).
   * `toolResultGuard` frames every tool result of the run as data; the SDK reads it per send, so
   * every send spreads `untrustedContentSendOptions()` (B-398, OC-88).
   */
  send(
    message: TurnMessage,
    options?: {
      readonly signal?: AbortSignal
      readonly toolResultGuard?: { readonly delimit?: boolean }
      /** `steer` injects the text into the turn already running (the advisor, OC-118). */
      readonly queueMode?: 'followup' | 'steer' | 'collect'
      /** Called with each `InteractionUpdate` as the model writes; `text-delta` carries the reply's text. */
      readonly onDelta?: (args: { readonly update: InteractionUpdate }) => void
    },
  ): Promise<TurnRun>
  /**
   * The SDK's goal loop (B-397 FR-008): it yields events and returns the final status and text. A
   * local SDK agent has it; an agent without it cannot run `/goal`, which then answers `failed`.
   */
  runUntil?(goal: string, options: GoalRunOptions): AsyncGenerator<unknown, GoalRunResult, void>
}

/** What `/goal` passes the goal loop: the budget, and the chat's own model for the judge (plan D4). */
export interface GoalRunOptions {
  readonly tokenBudget: number
  readonly agentModel: string
  readonly judgeApiKey: string
}

/** How a goal loop ended: `completed`, `budget_limited`, `failed`, `paused` or `blocked`, and its last answer. */
export interface GoalRunResult {
  readonly status: string
  readonly finalResponse?: string | undefined
}

/**
 * One event of the run's timeline (`run.events()`), narrowed to its kind. Typed narrowly for the
 * same reason as the stream element: the bridge's `SdkTimelineEvent` carries `SdkMessage`, whose
 * index signature the SDK's own event type does not declare.
 */
export interface TurnTimelineEvent {
  readonly kind: 'message' | 'delta'
  readonly message?: SdkMessageLike
  readonly update?: InteractionUpdate
  readonly textAlreadyStreamed?: boolean
}

/** What the translators read of an SDK message: its discriminant. The SDK's own messages have it. */
export interface SdkMessageLike {
  readonly type: string
}

/** A stream message as the bridge's `SdkMessage`; the copy carries the index signature the SDK's interfaces lack. */
export function toSdkMessage(message: SdkMessageLike): SdkMessage {
  return { ...message }
}

/** A timeline event as the bridge's `SdkTimelineEvent`, built field by field (no cast). */
export function toSdkTimelineEvent(event: TurnTimelineEvent): SdkTimelineEvent {
  return {
    kind: event.kind,
    ...(event.message === undefined ? {} : { message: toSdkMessage(event.message) }),
    ...(event.update === undefined ? {} : { update: event.update }),
    ...(event.textAlreadyStreamed === undefined ? {} : { textAlreadyStreamed: event.textAlreadyStreamed }),
  }
}

type FieldKind = 'string' | 'number' | 'boolean' | 'object' | 'defined'

/** The required fields of each `AgentStreamEvent` variant and the kind of each; optional fields are not checked. */
const REQUIRED_FIELDS: Readonly<Record<AgentStreamEvent['type'], Readonly<Record<string, FieldKind>>>> = {
  run_started: { runId: 'string', agentName: 'string' },
  text_delta: { content: 'string' },
  tool_call: { callId: 'string', toolName: 'string' },
  partial_tool_call: { callId: 'string', toolName: 'string' },
  tool_result: { callId: 'string', toolName: 'string', output: 'string', durationMs: 'number', isError: 'boolean' },
  thinking: { content: 'string' },
  iteration: { step: 'number' },
  approval_required: {
    callId: 'string',
    toolName: 'string',
    question: 'string',
    callbackUrl: 'string',
    timeoutMs: 'number',
  },
  input_requested: { requestId: 'string' },
  task_progress: {},
  shell_output: { event: 'object' },
  artifact_start: { artifactId: 'string', mimeType: 'string' },
  artifact_chunk: { artifactId: 'string', chunk: 'string', isLast: 'boolean' },
  state_update: { channel: 'string' },
  checkpoint_saved: { checkpointId: 'string', step: 'number', resumeToken: 'string' },
  file_edit: { file: 'string', format: 'string' },
  error: { code: 'string', message: 'string', retryable: 'boolean' },
  done: { result: 'string', usage: 'object', durationMs: 'number' },
}

function hasKind(value: unknown, kind: FieldKind): boolean {
  if (kind === 'defined') return value !== undefined
  if (kind === 'object') return typeof value === 'object' && value !== null
  return typeof value === kind
}

function isVariantType(type: string): type is AgentStreamEvent['type'] {
  return Object.hasOwn(REQUIRED_FIELDS, type)
}

/**
 * Whether a wire event is an `AgentStreamEvent`: its discriminant is one of the union's and every
 * required field of that variant is present with its kind. The one narrowing, no cast.
 */
export function isAgentStreamEvent(event: { readonly type: string }): event is AgentStreamEvent {
  if (!isVariantType(event.type)) return false
  const fields = Object.entries(event)
  return Object.entries(REQUIRED_FIELDS[event.type]).every(([name, kind]) =>
    hasKind(fields.find(([key]) => key === name)?.[1], kind),
  )
}

export interface TurnRun {
  stream(): AsyncIterable<SdkMessageLike>
  /**
   * How the run ended; a failed one may carry the SDK's error code. `result` is the final answer,
   * which a `delegate_all` worker hands back to its parent (B-386). `usage` and `cost` are the SDK
   * run's token counts and priced amount, which every finished turn reports (B-400, plan D1); an
   * `amountUsd` the SDK left undefined means the run was not priced, never that it was free.
   */
  wait(): Promise<{
    readonly status: string
    readonly result?: string
    readonly error?: { readonly code?: string }
    readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number }
    readonly cost?: { readonly amountUsd?: number | undefined }
  }>
  /** Move the run to cancelled and stop its in-flight tool calls; the SDK `Run` always has it (plan D2). */
  cancel(): Promise<void>
  /** Messages and live deltas in the order the loop produced them; what a session turn streams. */
  events?(): AsyncIterable<TurnTimelineEvent>
}
