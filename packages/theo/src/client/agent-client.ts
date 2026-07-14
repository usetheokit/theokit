import type { UIMessage, UIMessageChunk } from 'ai'

import { consumeChunkStream } from './consume-ui-message-stream.js'
import type { AgentTransport, ApprovalDecision, RequestContext } from './transport.js'

export type UseAgentStatus = 'idle' | 'streaming' | 'done' | 'error'

/** The observable state the store exposes (stable reference between emits — `useSyncExternalStore` contract). */
export interface AgentClientState {
  /** The CURRENT turn's assistant messages (per-turn; reset each `send`). Back-compat — unchanged since M41. */
  messages: UIMessage[]
  /**
   * M46 — the full conversation: committed turns + the current turn's user message + in-flight assistant.
   * Accumulated across sends (never reset except by `reset()`), with stable ids committed exactly once.
   * Render this instead of hand-rolling a transcript from `messages`.
   */
  thread: UIMessage[]
  status: UseAgentStatus
  error: Error | undefined
}

/** Derive the turn text from a typed input: `input.message` when present, else the serialized input. */
function inputToText(input: unknown): string {
  if (
    typeof input === 'object' &&
    input !== null &&
    typeof (input as { message?: unknown }).message === 'string'
  ) {
    return (input as { message: string }).message
  }
  if (typeof input === 'string') return input
  return JSON.stringify(input)
}

/** Build a user `UIMessage` from a typed input (text from `{ message }`, else the serialized input). */
function buildUserMessage(input: unknown): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    parts: [{ type: 'text', text: inputToText(input) }],
  }
}

/**
 * M41 (ADR-0050 D6) — the framework-agnostic agent client store.
 *
 * Holds `messages`/`status`/`error`, drives an {@link AgentTransport}, and notifies subscribers on
 * change. It is the SINGLE consolidation point: web (`HttpTransport`) and terminal/desktop
 * (`InProcessTransport`) run the SAME store. `useAgent` is a thin React binding over it via
 * `useSyncExternalStore`; a standalone (no-React) client (M44) can subscribe directly. Being
 * framework-agnostic, it is unit-tested without a DOM.
 */
export class AgentClient<TInput = unknown> {
  readonly #transport: AgentTransport
  readonly #chatId = crypto.randomUUID()
  readonly #listeners = new Set<() => void>()
  /** M43 — resolves per-request context (evaluated on every send/reconnect — dynamic, never stale). */
  readonly #contextResolver: (() => RequestContext | undefined) | undefined

  #messages: UIMessage[] = []
  #status: UseAgentStatus = 'idle'
  #error: Error | undefined
  #controller: AbortController | null = null
  // M46 — conversation accumulation (React-free; all surfaces inherit it via the snapshot).
  /** Committed (finished) turns — user + assistant, with stable fabricated ids. */
  #committed: UIMessage[] = []
  /** The current turn's user message (in `thread` but never in `messages` — back-compat). */
  #currentUser: UIMessage | undefined
  /** A stable id for the current turn's assistant (the SDK leaves it empty — we fabricate one). */
  #currentAssistantId = ''
  #snapshot: AgentClientState = { messages: [], thread: [], status: 'idle', error: undefined }

  constructor(transport: AgentTransport, contextResolver?: () => RequestContext | undefined) {
    this.#transport = transport
    this.#contextResolver = contextResolver
  }

  /** Subscribe to state changes; returns an unsubscribe fn. */
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** The current immutable snapshot (stable reference until the next emit). */
  getSnapshot = (): AgentClientState => this.#snapshot

  #emit(): void {
    // thread = committed turns + this turn's user + the in-flight assistant (`messages`). New array per
    // emit is fine — the SNAPSHOT reference only changes here, satisfying useSyncExternalStore.
    const thread = this.#currentUser
      ? [...this.#committed, this.#currentUser, ...this.#messages]
      : [...this.#committed, ...this.#messages]
    this.#snapshot = { messages: this.#messages, thread, status: this.#status, error: this.#error }
    for (const listener of this.#listeners) listener()
  }

  #upsert(message: UIMessage): void {
    const next = [...this.#messages]
    const idx = next.findIndex((existing) => existing.id === message.id)
    if (idx >= 0) next[idx] = message
    else next.push(message)
    this.#messages = next
  }

  async #drive(
    open: () => Promise<ReadableStream<UIMessageChunk> | null>,
    controller: AbortController,
  ): Promise<void> {
    // Read via a function (not a narrowed local) — `aborted` flips ASYNC across the awaits below, so the
    // control-flow narrowing of a direct `signal.aborted` read would be wrong. A stale drive (its
    // controller aborted because a newer send/abort took over) MUST NOT clobber the newer status.
    const aborted = (): boolean => controller.signal.aborted
    try {
      const stream = await open()
      if (aborted()) return
      if (stream === null) {
        // Nothing to resume (e.g. reconnect after the run completed). Settle without error.
        this.#status = this.#messages.length > 0 ? 'done' : 'idle'
        this.#emit()
        return
      }
      await consumeChunkStream(stream, (message) => {
        if (aborted()) return
        // The SDK leaves the assistant message id empty — fabricate a stable per-turn id so every chunk
        // upserts into the SAME message and the committed copy has a collision-free key (M46).
        const stamped = message.id ? message : { ...message, id: this.#currentAssistantId }
        this.#upsert(stamped)
        this.#emit()
      })
      if (aborted()) return
      this.#status = 'done'
      this.#emit()
    } catch (err) {
      if (aborted()) return
      this.#error = err instanceof Error ? err : new Error(String(err))
      this.#status = 'error'
      this.#emit()
    }
  }

  /** Send a typed input; opens a fresh stream (replaces prior messages). */
  send = (input: TInput): void => {
    // M46 — commit the PRIOR turn into history exactly once, but ONLY if it finished cleanly (`done`).
    // An errored or aborted turn (status !== 'done') is dropped, keeping committed history uncorrupted.
    if (this.#status === 'done' && this.#currentUser) {
      this.#committed = [...this.#committed, this.#currentUser, ...this.#messages]
    }
    this.abort()
    const controller = new AbortController()
    this.#controller = controller
    const userMsg = buildUserMessage(input)
    this.#currentUser = userMsg
    this.#currentAssistantId = crypto.randomUUID()
    this.#messages = []
    this.#error = undefined
    this.#status = 'streaming'
    this.#emit()
    const context = this.#contextResolver?.()
    void this.#drive(
      () =>
        this.#transport.sendMessages({
          trigger: 'submit-message',
          chatId: this.#chatId,
          messageId: undefined,
          messages: [userMsg],
          abortSignal: controller.signal,
          // Only object inputs flow as the request `body` (the turn text is always in `messages`);
          // a primitive input is carried by the user message, never spread into the body.
          body: typeof input === 'object' && input !== null ? input : undefined,
          // M43 — per-request context reaches every transport (headers → HTTP, metadata → in-process/channel).
          headers: context?.headers,
          metadata: context?.metadata,
        }),
      controller,
    )
  }

  /** Resume an interrupted stream via the transport's `reconnectToStream` (no-op when unavailable). */
  reconnect = (): void => {
    const controller = new AbortController()
    this.#controller = controller
    this.#status = 'streaming'
    this.#emit()
    const context = this.#contextResolver?.()
    void this.#drive(
      () =>
        this.#transport.reconnectToStream({
          chatId: this.#chatId,
          headers: context?.headers,
          metadata: context?.metadata,
        }),
      controller,
    )
  }

  /** Abort an in-flight stream (not an error — leaves messages as-is). */
  abort = (): void => {
    this.#controller?.abort()
    this.#controller = null
  }

  /** Clear messages + error, back to idle. */
  reset = (): void => {
    this.abort()
    this.#messages = []
    // M46 — reset means a NEW conversation: clear committed history + the current turn's user too.
    this.#committed = []
    this.#currentUser = undefined
    this.#error = undefined
    this.#status = 'idle'
    this.#emit()
  }

  /** Settle a paused HITL approval via the transport's HITL path (HTTP POST or inline callback). */
  approve = async (approvalId: string, decision: ApprovalDecision): Promise<void> => {
    await this.#transport.approve?.(approvalId, decision)
  }
}
