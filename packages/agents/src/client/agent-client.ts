import type {
  WireMessage as UIMessage,
  WireChunk as UIMessageChunk,
  WireToolApproval,
} from '@theokit/presenter/wire'
import { TheokitAgentError } from '@theokit/sdk/errors'

import { consumeChunkStream } from './consume-ui-message-stream.js'
import type { AgentTransport, ApprovalDecision, RequestContext } from './transport.js'

export type UseAgentStatus = 'idle' | 'streaming' | 'done' | 'error'

/**
 * The stream ended before the run did — theokit#384.
 *
 * ## Why the status is `'error'` and not a new `'interrupted'` member
 *
 * `UseAgentStatus` is published, and every surface in and out of this repo switches on it. Adding a
 * member fixes the lie only for the consumers who then update their switch; for everyone else the
 * new value falls through to the same "not streaming, not an error" branch that shows a finished
 * turn — the exact symptom, preserved. Reusing `'error'` fixes it for all of them at once, and it
 * is already the value the rest of this store treats correctly: `send()` refuses to commit a turn
 * that did not settle on `'done'`, so a half-answer stops being written into history as complete,
 * and the reconnect wiring the issue found disabled (`status === 'error'` → `reconnect()`) starts
 * firing without the consumer changing a line.
 *
 * ## Why the discrimination is a typed error rather than a status
 *
 * "The provider refused" and "the connection died" want opposite reactions — one is a failure to
 * report, the other is a turn that can be resumed — and this framework already has a place for that
 * difference: `TheokitAgentError`'s `code` + `isRetryable`, which `isTransientError` reads. A class
 * outside that hierarchy is invisible to it and leaves the consumer matching on message text (M80).
 *
 * ## Why this is NOT a `stopReason` (theokit#379)
 *
 * The two are orthogonal, and collapsing them would be a category error. `stopReason` says why the
 * RUN stopped and rides the `finish` chunk's metadata — it exists only when a terminal frame
 * arrived. An interruption is the ABSENCE of that frame: the run may still be going, and this
 * client cannot know why it stopped, because it never heard. Spelling it as a third `stopReason`
 * member would put a value on a `done` turn that no producer produced, and would reintroduce the
 * defect it fixes — a truncated run reported through the field that means "the agent finished".
 * Transport termination and execution termination are separate axes; this is the transport one.
 */
export class AgentStreamInterruptedError extends TheokitAgentError {
  override readonly name = 'AgentStreamInterruptedError'
  constructor(readonly chunksReceived: number) {
    super(
      `The agent stream ended after ${String(chunksReceived)} chunk(s) without its terminal frame — ` +
        `the connection dropped mid-run, so the answer on screen is incomplete.`,
      {
        // A dropped connection is the definition of transient: the run may still be alive on the
        // server, and `AgentClient.reconnect()` is the affordance built for it. DECLARED, because a
        // default here would be a retry policy nobody chose.
        isRetryable: true,
        code: 'AGENT_STREAM_INTERRUPTED',
      },
    )
  }
}

/**
 * One HITL decision the run is parked on, flattened for the surface that renders it
 * (usetheokit/theokit#392).
 *
 * ## Why the store publishes this at all, when the part already carries it
 *
 * `approve()` needs an id. Before this field the snapshot had four keys and none of them was that
 * id, so an application had two options: scan every part of every message for `state ===
 * 'approval-requested'`, or poll `GET /api/agents/<name>/approvals` out of band — which is what the
 * measured J2 client did, at twelve lines and two React primitives, through an endpoint under a
 * security advisory. Publishing the id is what removes the reason to reach for either.
 *
 * ## Why it is DERIVED and not accumulated
 *
 * It is computed from the current turn's parts on each emit, never written by a second reducer. A
 * separate list would need its own settle path and could then disagree with the transcript about
 * whether a decision is outstanding — and the transcript is what renders. Deriving makes the two
 * unable to drift: a settled gate leaves `approval-requested` on the same chunk that fills in the
 * output, so it leaves this array in the same step.
 *
 * ## Why plural
 *
 * The SDK dispatches a round's calls concurrently (`mapWithConcurrency`), so two gated calls of the
 * same tool can be outstanding at once — pinned by
 * `tests/integration/hitl-call-correlation.test.ts`. A singular field would have to pick one and
 * would be silently wrong exactly when a human has two things to decide.
 */
export interface PendingApproval {
  /** The id `approve()` settles. */
  readonly approvalId: string
  /** The call this gate holds — the same id `tool-input-available` announced. */
  readonly toolCallId: string
  /** The gated tool's name, off the part. `undefined` only if the producer announced none. */
  readonly toolName: string | undefined
  /** The resolved arguments the human is authorising, off the part. */
  readonly input: unknown
  /** The question declared on the gate, when the producer sent one. */
  readonly question?: string
  /** The window before the gate settles itself, in ms, when the producer sent one. */
  readonly timeoutMs?: number
}

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
  /**
   * The HITL decisions this turn is parked on, newest last. Empty whenever nothing is outstanding.
   * Each entry carries the id `approve()` takes plus what the prompt needs to name the action.
   */
  pendingApprovals: PendingApproval[]
}

/** The empty array served whenever no gate is outstanding — one allocation, not one per emit. */
const NO_PENDING_APPROVALS: PendingApproval[] = []

/**
 * Project the current turn's parts into the outstanding decisions (see {@link PendingApproval}).
 *
 * Scans `messages` (the current turn) and not `thread`: a turn only reaches `#committed` on `done`,
 * and a run cannot finish while parked inside the awaited approval hook, so a committed turn has no
 * live gate to find. Scanning the whole thread would re-walk every historical part on every token
 * delta for a result that cannot change.
 */
function derivePendingApprovals(messages: UIMessage[]): PendingApproval[] {
  let pending: PendingApproval[] | undefined
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.state !== 'approval-requested') continue
      const approval = part.approval as WireToolApproval | undefined
      // A part in this state without an id would be a reader defect, not a decision a human can
      // settle — skipped rather than published as an entry whose `approve()` call cannot work.
      if (typeof approval?.id !== 'string') continue
      pending ??= []
      pending.push({
        approvalId: approval.id,
        toolCallId: String(part.toolCallId),
        toolName: typeof part.toolName === 'string' ? part.toolName : undefined,
        input: part.input,
        ...(approval.question !== undefined ? { question: approval.question } : {}),
        ...(approval.timeoutMs !== undefined ? { timeoutMs: approval.timeoutMs } : {}),
      })
    }
  }
  return pending ?? NO_PENDING_APPROVALS
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
/**
 * M92 — client options. Additive: without them, the behaviour is exactly as before.
 */
export interface AgentClientOptions {
  /**
   * Coalescing window in ms. `0` or absent = emit per token delta (the pre-M92 behaviour).
   *
   * Opt-in on purpose: this is a published package, and changing the emit frequency by default would
   * change the observable behaviour of anyone counting emits or depending on first-token latency.
   */
  readonly emitIntervalMs?: number
}

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
  #snapshot: AgentClientState = {
    messages: [],
    thread: [],
    status: 'idle',
    error: undefined,
    pendingApprovals: NO_PENDING_APPROVALS,
  }

  /**
   * M92 — the committed prefix, materialized ONCE per write instead of once per token delta.
   *
   * `#committed` changes in only two places (measured): in `send()`'s `done` and in `reset()`. Between
   * deltas it is constant, so rebuilding it on every `#emit` is work the structure already guarantees
   * is useless.
   *
   * Invalidation happens **on write**, not by comparison: comparing would cost the same O(C) this
   * avoids, and memoizing by length would be wrong in `reset()` — equal length with different content
   * is possible, and the bug would be invisible.
   *
   * Honesty about the size of the win: measured, the spread costs **0.0062 ms per delta @400 messages**
   * — 3.1 ms across a 500-delta turn. It is real and it is micro. The order of magnitude of this
   * milestone is in the coalescing below, because what hangs off each emit (deriving the timeline)
   * costs **3.274 ms per call** at the same thread size (M86).
   */
  #committedPrefix: UIMessage[] = []

  /** Opt-in coalescing: `0` (the default) emits per delta, as always. */
  readonly #emitIntervalMs: number
  #timerDeEmit: ReturnType<typeof setTimeout> | undefined

  constructor(
    transport: AgentTransport,
    contextResolver?: () => RequestContext | undefined,
    options?: AgentClientOptions,
  ) {
    this.#transport = transport
    this.#contextResolver = contextResolver
    this.#emitIntervalMs = options?.emitIntervalMs ?? 0
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

  /**
   * Emits NOW. Used directly on status transitions — see `#scheduleEmit`.
   */
  #emit(): void {
    if (this.#timerDeEmit !== undefined) {
      clearTimeout(this.#timerDeEmit)
      this.#timerDeEmit = undefined
    }
    // thread = committed prefix + this turn's user message + the in-flight assistant (`messages`). The
    // prefix arrives materialized (`#prefix`); only the tail is concatenated here. The SNAPSHOT
    // reference changes only at this point, which is the contract `useSyncExternalStore` requires.
    // A SINGLE `concat`, not two spreads.
    //
    // M92's first version swapped `#committed` for `#prefix` and kept the spread — and `#prefix` was
    // the **same array**, a pure alias. The review measured it: 0.16 µs @C=20 → ~2 µs @C=400, still
    // linear in C, i.e. byte-identical to before. The DoD asked for a lazy getter or a single concat;
    // what I had delivered was a rename.
    //
    // `concat` copies the prefix once per emit instead of spreading it element by element, and the
    // engine uses memcpy for dense arrays. It is still O(C) — there is no way to return a new array
    // without copying — but with a smaller constant, and it is honest to say the win here is in the
    // constant, not in the order.
    const tail = this.#currentUser ? [this.#currentUser, ...this.#messages] : this.#messages
    const thread = this.#committedPrefix.concat(tail)
    this.#snapshot = {
      messages: this.#messages,
      thread,
      status: this.#status,
      error: this.#error,
      pendingApprovals: derivePendingApprovals(this.#messages),
    }
    for (const listener of this.#listeners) listener()
  }

  /**
   * Emits per WINDOW when coalescing is on; immediately when it is off.
   *
   * Trailing edge: the timer emits at the **end** of the window, with the most recent state. What this
   * buys is not a cheaper emit — it is **fewer emits**, and what hangs off each one is the 3.274 ms
   * derivation measured in M86.
   *
   * Status transitions (`done`/`error`/`abort`) do NOT go through here: they call `#emit` directly,
   * because a final state trapped in a 16 ms timer is a final state lost if the process exits first —
   * and `exec` exits right after the turn.
   */
  #scheduleEmit(): void {
    if (this.#emitIntervalMs <= 0) {
      this.#emit()
      return
    }
    if (this.#timerDeEmit !== undefined) return
    this.#timerDeEmit = setTimeout(() => {
      this.#timerDeEmit = undefined
      this.#emit()
    }, this.#emitIntervalMs)
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
      const outcome = await consumeChunkStream(stream, (message) => {
        if (aborted()) return
        // The SDK leaves the assistant message id empty — fabricate a stable per-turn id so every chunk
        // upserts into the SAME message and the committed copy has a collision-free key (M46).
        const stamped = message.id ? message : { ...message, id: this.#currentAssistantId }
        this.#upsert(stamped)
        // The ONLY per-token-delta point — every other `#emit` in this file is a status transition,
        // and those never wait on a timer (ADR-2).
        this.#scheduleEmit()
      })
      if (aborted()) return
      // theokit#384 — a stream that RAN OUT is not a stream that FINISHED. Until this branch existed
      // there were only two outcomes here, "the reader threw" and "it did not", and a dropped socket
      // reports neither: `reader.read()` says `done`, nothing rejects, and a run cut mid-word settled
      // as an ordinary `done`. The messages already delivered are kept — the user is told the answer
      // is incomplete, not shown an empty turn.
      if (!outcome.terminated) {
        this.#error = new AgentStreamInterruptedError(outcome.chunksReceived)
        this.#status = 'error'
        this.#emit()
        return
      }
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
      // Invalidation ON WRITE (ADR-3): this is one of only two points that touch `#committed`.
      this.#committedPrefix = this.#committed
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
    // Reconnecting before any send() (or after reset()) leaves #currentAssistantId empty — fabricate one
    // so a replayed assistant never lands in `thread` with an empty, non-unique id (M46 invariant).
    if (!this.#currentAssistantId) this.#currentAssistantId = crypto.randomUUID()
    // Reconnect means "resume/retry" — a stale error must not linger next to a fresh 'streaming' status.
    this.#error = undefined
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
    // Finalize the status when the USER aborts an in-flight turn: the aborted `#drive` early-returns
    // without touching status (so a stale drive can't clobber a newer turn), which would otherwise leave
    // `status` stuck on 'streaming' — a lingering spinner + an unusable surface. A caller that aborts to
    // start a NEW turn (`send`/`sendMessages`) sets 'streaming' again immediately after, so this is safe.
    if (this.#status === 'streaming') {
      this.#status = this.#committed.length > 0 || this.#messages.length > 0 ? 'done' : 'idle'
      this.#emit()
    }
  }

  /** Clear messages + error, back to idle. */
  reset = (): void => {
    this.abort()
    this.#messages = []
    // M46 — reset means a NEW conversation: clear committed history + the current turn's user too.
    this.#committed = []
    // The other write point. Without this, `reset()` would serve the stale prefix — and equal length
    // with different content is exactly the case a size-based memoization would not catch.
    this.#committedPrefix = this.#committed
    this.#currentUser = undefined
    this.#error = undefined
    this.#status = 'idle'
    this.#emit()
  }

  /**
   * Settle a paused HITL approval via the transport's HITL path (HTTP POST or inline callback).
   *
   * The signature is unchanged by usetheokit/theokit#392, deliberately. What that issue reported was
   * not that `approve` takes an id — it was that nothing HANDED the caller one, so the id had to be
   * mined out of band. `pendingApprovals` hands it over, and taking the entry instead of its
   * `approvalId` would save no line while adding a second accepted shape to a published method that
   * surfaces outside this repository (`@theokit/tui`, `@theokit/ui`).
   */
  approve = async (approvalId: string, decision: ApprovalDecision): Promise<void> => {
    await this.#transport.approve?.(approvalId, decision)
  }
}
