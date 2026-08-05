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
 * Uma aprovação estacionada foi descartada porque o turno terminou sem decisão.
 *
 * M92 — tipado de propósito. Antes a promessa simplesmente **nunca** resolvia, e a chamada de tool do
 * SDK pendurava; `resolve(false)` seria pior ainda, porque é indistinguível de "o usuário negou".
 */
export class ApprovalAbortedError extends Error {
  constructor(
    readonly approvalId: string,
    motivo: string,
  ) {
    super(`Aprovação '${approvalId}' descartada: ${motivo}.`)
    this.name = 'ApprovalAbortedError'
  }
}

export class InProcessTransport implements AgentTransport {
  readonly #run: InProcessRunner
  /**
   * Aprovações inline estacionadas: `approvalId` → como resolver **ou rejeitar** a promessa parada.
   *
   * M92 — o `reject` entrou junto com a eviction. Antes havia só o `resolve`, e nada apagava a entrada
   * quando o turno abortava: a promessa ficava pendente **para sempre**, e a chamada de tool do SDK
   * pendurava com ela. Uma promessa que nunca resolve **nem** rejeita é a forma mais silenciosa de
   * engolir um erro — nem stack trace existe (`error-handling.md § 2`).
   */
  readonly #pending = new Map<
    string,
    {
      resolve: (decision: boolean | ApprovalDecision) => void
      reject: (err: Error) => void
      turno: number
    }
  >()

  /** O turno corrente. Um `send()` novo incrementa e varre o anterior. */
  #turno = 0

  constructor(options: InProcessTransportOptions) {
    this.#run = options.run
  }

  /**
   * Cria o `awaitApproval` DESTE turno, com o número e o sinal fechados no closure.
   *
   * Campo compartilhado não serve, e a revisão do M92 mediu por quê: um runner do turno 1 que
   * estaciona **depois** do `send` do turno 2 lê o campo já sobrescrito e nasce etiquetado turno 2 —
   * o abort do turno 1 não o varre, e a promessa pendura. A primeira correção do M92 trocou "ler no
   * momento da aprovação" por "ler no `send`", e continuou errada pela mesma razão: um campo só.
   *
   * O closure é o único lugar onde o turno de um runner pode viver sem ser sobrescrito por outro.
   */
  #criarAwaitApproval(turno: number, sinal: AbortSignal | undefined): InProcessAwaitApproval {
    return (req) =>
      new Promise<boolean | ApprovalDecision>((resolve, reject) => {
        // Abortado ANTES de a aprovação estacionar: varrer no `sendMessages` não alcança este caso,
        // porque naquele momento não havia nada a varrer.
        if (sinal?.aborted === true) {
          reject(new ApprovalAbortedError(req.approvalId, 'o turno já estava abortado'))
          return
        }
        // Ids de aprovação são UUIDs do servidor — colisão é bug real (dois turnos reusando um id).
        // Falha rápido em vez de sobrescrever em silêncio o resolver estacionado do turno anterior.
        if (this.#pending.has(req.approvalId)) {
          reject(
            new Error(`Duplicate pending approval id '${req.approvalId}' — ids must be unique.`),
          )
          return
        }
        this.#pending.set(req.approvalId, { resolve, reject, turno })
      })
  }

  /**
   * Varre as aprovações de um turno, rejeitando cada uma com erro TIPADO.
   *
   * Rejeitar e não `resolve(false)`: um `false` é indistinguível de *"o usuário negou"*, e a diferença
   * importa — negar é decisão, abortar é interrupção. O SDK precisa das duas para desenrolar a chamada
   * de tool corretamente.
   */
  #varrerTurno(turno: number, motivo: string): void {
    for (const [id, entrada] of [...this.#pending]) {
      if (entrada.turno !== turno) continue
      this.#pending.delete(id)
      entrada.reject(new ApprovalAbortedError(id, motivo))
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
    // M92 — um `send()` novo varre o turno anterior: aprovações daquele turno nunca mais serão
    // decididas, e deixá-las no `Map` é vazamento com uma promessa pendurada em cada uma.
    this.#varrerTurno(this.#turno, 'um turno novo começou')
    this.#turno += 1
    const turnoAtual = this.#turno

    // O sinal de abort do turno é a costura que já chegava aqui e não era usada. `once` porque um
    // `AbortSignal` dispara no máximo uma vez, e reter o listener manteria o transporte vivo.
    // Sinal JÁ abortado não dispara `addEventListener` — a revisão do M92 mediu: `pendentes=1` e a
    // promessa PENDENTE, ou seja, exatamente o travamento que este milestone existe para fechar,
    // ainda alcançável. A varredura roda na hora e o listener cobre o abort que vier depois.
    if (abortSignal?.aborted === true) {
      this.#varrerTurno(turnoAtual, 'o turno já estava abortado')
    } else {
      abortSignal?.addEventListener(
        'abort',
        () => {
          this.#varrerTurno(turnoAtual, 'o turno foi abortado')
        },
        { once: true },
      )
    }
    const generator = this.#run({
      message: extractLastUserText(messages),
      signal: abortSignal ?? undefined,
      awaitApproval: this.#criarAwaitApproval(turnoAtual, abortSignal ?? undefined),
      // M43 — forward per-request context (the seam's `metadata`) to the runner.
      context: metadata,
    })
    return Promise.resolve(generatorToStream(generator))
  }

  reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return Promise.resolve(null)
  }

  approve(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const entrada = this.#pending.get(approvalId)
    if (entrada === undefined) {
      return Promise.reject(
        new Error(`No pending approval '${approvalId}' (unknown or already settled).`),
      )
    }
    this.#pending.delete(approvalId)
    entrada.resolve(decision)
    return Promise.resolve()
  }
}
