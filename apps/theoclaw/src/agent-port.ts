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
    ...(event.textAlreadyStreamed === undefined
      ? {}
      : { textAlreadyStreamed: event.textAlreadyStreamed }),
  }
}

const AGENT_STREAM_EVENT_TYPES: ReadonlySet<string> = new Set([
  'run_started',
  'text_delta',
  'tool_call',
  'partial_tool_call',
  'tool_result',
  'thinking',
  'iteration',
  'approval_required',
  'input_requested',
  'task_progress',
  'shell_output',
  'artifact_start',
  'artifact_chunk',
  'state_update',
  'checkpoint_saved',
  'file_edit',
  'error',
  'done',
])

/**
 * Whether a wire event is one the bridge's `AgentStreamEvent` names: a known discriminant, and for
 * `text_delta` its string `content`. The bridge ships no validator for the rest of each event's
 * fields, so that stays the bridge's follow-up (#2342).
 */
export function isAgentStreamEvent(event: { readonly type: string }): event is AgentStreamEvent {
  if (!AGENT_STREAM_EVENT_TYPES.has(event.type)) return false
  return event.type !== 'text_delta' || ('content' in event && typeof event.content === 'string')
}
