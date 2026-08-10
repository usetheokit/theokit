import type {
  WireTransport as ChatTransport,
  WireChunk as UIMessageChunk,
} from '@theokit/presenter/wire'

import { extractLastUserText } from './last-user-text.js'
import type { AgentTransport, ApprovalDecision } from './transport.js'

/** An inline approval request handed to the transport's resolver (structural — no server import). */
export interface InProcessApprovalRequestLike {
  approvalId: string
  toolName: string
  opts: unknown
}

/** Resolve one gated-tool approval inline (mirrors the SDK's `boolean | HitlDecision` return). */
export type InProcessAwaitApproval = (
  req: InProcessApprovalRequestLike,
) => Promise<boolean | ApprovalDecision>

/** The input the injected runner receives (structurally compatible with `StreamAgentTurnInProcessInput`). */
export interface InProcessRunInput {
  message: string
  sessionId?: string
  signal?: AbortSignal
  awaitApproval?: InProcessAwaitApproval
  /** M43 — per-request context (from `sendMessages`'s `metadata`) — tenant / provider / auth for the runner. */
  context?: unknown
}

/**
 * The in-process turn runner. The consumer binds `streamAgentTurnInProcess(mod, apiKey, …)`:
 * `new InProcessTransport({ run: (input) => streamAgentTurnInProcess(mod, apiKey, input) })`.
 * Injecting it keeps this client module decoupled from `server/` and makes the transport testable.
 */
export type InProcessRunner = (input: InProcessRunInput) => AsyncGenerator<UIMessageChunk>

export interface InProcessTransportOptions {
  run: InProcessRunner
}

/** Bridge an `AsyncGenerator<UIMessageChunk>` into a pull-based `ReadableStream<UIMessageChunk>`. */
function generatorToStream(gen: AsyncGenerator<UIMessageChunk>): ReadableStream<UIMessageChunk> {
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      try {
        const result = await gen.next()
        if (result.done === true) {
          controller.close()
          return
        }
        // After the done-guard, `result` is an IteratorYieldResult<UIMessageChunk> — value is typed.
        controller.enqueue(result.value)
      } catch (err) {
        controller.error(err)
      }
    },
    async cancel() {
      await gen.return(undefined)
    },
  })
}

/**
 * M41 (ADR-0050 D4) — `ChatTransport` over the in-process seam (`streamAgentTurnInProcess`), for the
 * terminal/desktop surfaces that run client + server in ONE process (no HTTP loopback).
 *
 * - `sendMessages`: bridge the injected runner's `AsyncGenerator<UIMessageChunk>` into a
 *   `ReadableStream<UIMessageChunk>` (honoring `abortSignal`, which the runner forwards to the SDK).
 * - `reconnectToStream`: always `null` — a single process has no dropped server-side stream to resume
 *   (mirrors `ai`'s `DirectChatTransport`).
 * - `approve`: resolve the pending inline approval by id (the run parks on `awaitApproval`). An unknown
 *   id rejects (fail-fast, Rule 8 — never a silent resolve).
 *
 * Error asymmetry vs `HttpTransport` (by design, matching the `ChatTransport` contract): a runner that
 * throws SYNCHRONOUSLY surfaces the error when the stream is READ (via `controller.error`), not from the
 * `sendMessages` promise — whereas `HttpTransport` throws from `sendMessages` on a non-2xx response.
 */
/**
 * A parked approval was discarded because the turn ended with no decision.
 *
 * M92 — typed on purpose. Before, the promise simply **never** settled and the SDK tool call hung;
 * `resolve(false)` would be worse still, because it is indistinguishable from "the user denied".
 */
export class ApprovalAbortedError extends Error {
  constructor(
    readonly approvalId: string,
    reason: string,
  ) {
    super(`Approval '${approvalId}' discarded: ${reason}.`)
    this.name = 'ApprovalAbortedError'
  }
}

export class InProcessTransport implements AgentTransport {
  readonly #run: InProcessRunner
  /**
   * Parked inline approvals: `approvalId` → how to resolve **or reject** the stalled promise.
   *
   * M92 — `reject` arrived together with the eviction. Before there was only `resolve`, and nothing
   * erased the entry when the turn aborted: the promise stayed pending **forever**, and the SDK tool
   * call hung with it. A promise that neither resolves **nor** rejects is the quietest way to swallow
   * an error — not even a stack trace exists (`error-handling.md § 2`).
   */
  readonly #pending = new Map<
    string,
    {
      resolve: (decision: boolean | ApprovalDecision) => void
      reject: (err: Error) => void
      turn: number
    }
  >()

  /** The current turn. A new `send()` increments it and sweeps the previous one. */
  #turn = 0

  constructor(options: InProcessTransportOptions) {
    this.#run = options.run
  }

  /**
   * Creates the `awaitApproval` for THIS turn, with the number and the signal closed over.
   *
   * A shared field will not do, and the M92 review measured why: a turn-1 runner that parks **after**
   * turn 2's `send` reads the already-overwritten field and is born labelled turn 2 — turn 1's abort
   * does not sweep it, and the promise hangs. M92's first fix swapped "read at approval time" for
   * "read at `send`", and stayed wrong for the same reason: a single field.
   *
   * The closure is the only place a runner's turn can live without another one overwriting it.
   */
  #createAwaitApproval(turn: number, signal: AbortSignal | undefined): InProcessAwaitApproval {
    return (req) =>
      new Promise<boolean | ApprovalDecision>((resolve, reject) => {
        // Aborted BEFORE the approval parked: sweeping in `sendMessages` does not reach this case,
        // because at that moment there was nothing to sweep.
        if (signal?.aborted === true) {
          reject(new ApprovalAbortedError(req.approvalId, 'the turn was already aborted'))
          return
        }
        // Approval ids are server UUIDs — a collision is a real bug (two turns reusing one id).
        // Fail fast instead of silently overwriting the previous turn's parked resolver.
        if (this.#pending.has(req.approvalId)) {
          reject(
            new Error(`Duplicate pending approval id '${req.approvalId}' — ids must be unique.`),
          )
          return
        }
        this.#pending.set(req.approvalId, { resolve, reject, turn })
      })
  }

  /**
   * Sweeps a turn's approvals, rejecting each one with a TYPED error.
   *
   * Reject rather than `resolve(false)`: a `false` is indistinguishable from *"the user denied"*, and
   * the difference matters — denying is a decision, aborting is an interruption. The SDK needs both to
   * unwind the tool call correctly.
   */
  #sweepTurn(turn: number, reason: string): void {
    for (const [id, entry] of [...this.#pending]) {
      if (entry.turn !== turn) continue
      this.#pending.delete(id)
      entry.reject(new ApprovalAbortedError(id, reason))
    }
  }

  /** How many approvals are parked. Exists so the test can prove the eviction. */
  get pending(): number {
    return this.#pending.size
  }

  sendMessages(
    options: Parameters<ChatTransport['sendMessages']>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal, metadata } = options
    // M92 — a new `send()` sweeps the previous turn: approvals from that turn will never be decided
    // again, and leaving them in the `Map` is a leak with a promise hanging off each one.
    this.#sweepTurn(this.#turn, 'a new turn started')
    this.#turn += 1
    const currentTurn = this.#turn

    // The turn's abort signal is the seam that already reached here and went unused. `once` because
    // an `AbortSignal` fires at most once, and holding the listener would keep the transport alive.
    // An ALREADY aborted signal does not fire `addEventListener` — M92's review measured it:
    // `pending=1` with the promise PENDING, i.e. exactly the hang this milestone exists to close,
    // still reachable. The sweep runs immediately and the listener covers any later abort.
    if (abortSignal?.aborted === true) {
      this.#sweepTurn(currentTurn, 'the turn was already aborted')
    } else {
      abortSignal?.addEventListener(
        'abort',
        () => {
          this.#sweepTurn(currentTurn, 'the turn was aborted')
        },
        { once: true },
      )
    }
    const generator = this.#run({
      message: extractLastUserText(messages),
      signal: abortSignal ?? undefined,
      awaitApproval: this.#createAwaitApproval(currentTurn, abortSignal ?? undefined),
      // M43 — forward per-request context (the seam's `metadata`) to the runner.
      context: metadata,
    })
    return Promise.resolve(generatorToStream(generator))
  }

  reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return Promise.resolve(null)
  }

  approve(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const entry = this.#pending.get(approvalId)
    if (entry === undefined) {
      return Promise.reject(
        new Error(`No pending approval '${approvalId}' (unknown or already settled).`),
      )
    }
    this.#pending.delete(approvalId)
    entry.resolve(decision)
    return Promise.resolve()
  }
}
