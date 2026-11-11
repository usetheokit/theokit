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
      /** `steer` injects the text into the turn already running; with none running it starts one (OC-52). */
      readonly queueMode?: 'followup' | 'steer' | 'collect'
      /** Called with each `InteractionUpdate` as the model writes; `text-delta` carries the reply's text. */
      readonly onDelta?: (args: { readonly update: { readonly type: string } }) => void
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
}

export interface TurnRun {
  stream(): AsyncIterable<{ readonly type: string }>
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
