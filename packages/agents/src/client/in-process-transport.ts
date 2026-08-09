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
  #criarAwaitApproval(turn: number, sinal: AbortSignal | undefined): InProcessAwaitApproval {
    return (req) =>
      new Promise<boolean | ApprovalDecision>((resolve, reject) => {
        // Abortado ANTES de a aprovação estacionar: varrer no `sendMessages` não alcança este caso,
        // porque naquele momento não havia nada a varrer.
        if (sinal?.aborted === true) {
          reject(new ApprovalAbortedError(req.approvalId, 'o turn já estava abortado'))
          return
        }
        // Ids de aprovação são UUIDs do servidor — colisão é bug real (dois turnos reusando um id).
        // Falha rápido em vez de sobrescrever em silêncio o resolver estacionado do turn anterior.
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
   * Varre as aprovações de um turn, rejeitando cada uma com erro TIPADO.
   *
   * Rejeitar e não `resolve(false)`: um `false` é indistinguível de *"o usuário negou"*, e a diferença
   * importa — negar é decisão, abortar é interrupção. O SDK precisa das duas para desenrolar a chamada
   * de tool corretamente.
   */
  #varrerTurno(turn: number, reason: string): void {
    for (const [id, entry] of [...this.#pending]) {
      if (entry.turn !== turn) continue
      this.#pending.delete(id)
      entry.reject(new ApprovalAbortedError(id, reason))
    }
  }

  /** Quantas aprovações estão estacionadas. Existe para o teste poder provar a eviction. */
  get pendentes(): number {
    return this.#pending.size
  }

  sendMessages(
    options: Parameters<ChatTransport['sendMessages']>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal, metadata } = options
    // M92 — um `send()` novo varre o turn anterior: aprovações daquele turn nunca mais serão
    // decididas, e deixá-las no `Map` é vazamento com uma promessa pendurada em cada uma.
    this.#varrerTurno(this.#turn, 'um turn novo começou')
    this.#turn += 1
    const currentTurn = this.#turn

    // O sinal de abort do turn é a costura que já chegava aqui e não era usada. `once` porque um
    // `AbortSignal` dispara no máximo uma vez, e reter o listener manteria o transporte vivo.
    // Sinal JÁ abortado não dispara `addEventListener` — a revisão do M92 mediu: `pendentes=1` e a
    // promessa PENDENTE, ou seja, exatamente o travamento que este milestone existe para fechar,
    // ainda alcançável. A varredura roda na hora e o listener cobre o abort que vier depois.
    if (abortSignal?.aborted === true) {
      this.#varrerTurno(currentTurn, 'o turn já estava abortado')
    } else {
      abortSignal?.addEventListener(
        'abort',
        () => {
          this.#varrerTurno(currentTurn, 'o turn foi abortado')
        },
        { once: true },
      )
    }
    const generator = this.#run({
      message: extractLastUserText(messages),
      signal: abortSignal ?? undefined,
      awaitApproval: this.#criarAwaitApproval(currentTurn, abortSignal ?? undefined),
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
