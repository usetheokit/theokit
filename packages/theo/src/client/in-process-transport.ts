import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

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
export class InProcessTransport implements AgentTransport {
  readonly #run: InProcessRunner
  /** Pending inline approvals: approvalId → resolver of the parked `awaitApproval` promise. */
  readonly #pending = new Map<string, (decision: boolean | ApprovalDecision) => void>()

  constructor(options: InProcessTransportOptions) {
    this.#run = options.run
  }

  #awaitApproval: InProcessAwaitApproval = (req) =>
    new Promise<boolean | ApprovalDecision>((resolve, reject) => {
      // Approval ids are server-minted UUIDs — a collision means a real bug (two turns reusing an id).
      // Fail fast rather than silently overwrite the earlier turn's parked resolver (Rule 8).
      if (this.#pending.has(req.approvalId)) {
        reject(new Error(`Duplicate pending approval id '${req.approvalId}' — ids must be unique.`))
        return
      }
      this.#pending.set(req.approvalId, resolve)
    })

  sendMessages(
    options: Parameters<ChatTransport<UIMessage>['sendMessages']>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal } = options
    const generator = this.#run({
      message: extractLastUserText(messages),
      signal: abortSignal ?? undefined,
      awaitApproval: this.#awaitApproval,
    })
    return Promise.resolve(generatorToStream(generator))
  }

  reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return Promise.resolve(null)
  }

  approve(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const resolve = this.#pending.get(approvalId)
    if (resolve === undefined) {
      return Promise.reject(
        new Error(`No pending approval '${approvalId}' (unknown or already settled).`),
      )
    }
    this.#pending.delete(approvalId)
    resolve(decision)
    return Promise.resolve()
  }
}
