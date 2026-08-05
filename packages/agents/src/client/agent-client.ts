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
/**
 * M92 — opções do cliente. Aditivo: sem elas, o comportamento é o de sempre.
 */
export interface AgentClientOptions {
  /**
   * Janela de coalescing em ms. `0` ou ausente = emite por delta de token (comportamento pré-M92).
   *
   * Opt-in de propósito: este é um pacote publicado, e mudar a frequência de emit por padrão mudaria o
   * comportamento observável de quem conta emits ou depende da latência do primeiro token.
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
  #snapshot: AgentClientState = { messages: [], thread: [], status: 'idle', error: undefined }

  /**
   * M92 — o prefixo commitado, materializado UMA vez por escrita em vez de por delta de token.
   *
   * `#committed` só muda em dois lugares (medido): no `done` de `send()` e em `reset()`. Entre deltas
   * ele é constante, então reconstruí-lo a cada `#emit` é trabalho que a estrutura já garante inútil.
   *
   * Invalidação é **na escrita**, não por comparação: comparar custaria o mesmo O(C) que isto evita, e
   * memoizar por comprimento erraria em `reset()` — comprimento igual com conteúdo diferente é
   * possível, e o bug seria invisível.
   *
   * Honestidade sobre o tamanho do ganho: medido, o spread custa **0,0062 ms por delta @400 mensagens**
   * — 3,1 ms num turno de 500 deltas. É real e é micro. A ordem de grandeza deste milestone está no
   * coalescing abaixo, porque o que pende de cada emit (a derivação da timeline) custa **3,274 ms por
   * chamada** no mesmo tamanho de thread (M86).
   */
  #prefixo: UIMessage[] = []

  /** Coalescing opt-in: `0` (default) emite por delta, como sempre. */
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
   * Emite AGORA. Usado diretamente nas transições de status — ver `#agendarEmit`.
   */
  #emit(): void {
    if (this.#timerDeEmit !== undefined) {
      clearTimeout(this.#timerDeEmit)
      this.#timerDeEmit = undefined
    }
    // thread = prefixo commitado + o user deste turno + o assistant em voo (`messages`). O prefixo vem
    // materializado (`#prefixo`); só a cauda é concatenada aqui. A referência do SNAPSHOT muda só neste
    // ponto, que é o contrato que `useSyncExternalStore` exige.
    // `concat` ÚNICO, não dois spreads.
    //
    // A primeira versão do M92 trocou `#committed` por `#prefixo` e manteve o spread — e `#prefixo` era
    // o **mesmo array**, um alias puro. A revisão mediu: 0,16 µs @C=20 → ~2 µs @C=400, ainda linear em
    // C, ou seja, byte-idêntico ao anterior. O DoD pedia getter preguiçoso ou concat único; eu tinha
    // entregue um rename.
    //
    // `concat` copia o prefixo uma vez por emit em vez de espalhá-lo elemento a elemento, e o motor
    // usa memcpy para arrays densos. Continua O(C) — não há como devolver um array novo sem copiar —
    // mas com constante menor, e é honesto dizer que o ganho aqui é de constante, não de ordem.
    const cauda = this.#currentUser ? [this.#currentUser, ...this.#messages] : this.#messages
    const thread = this.#prefixo.concat(cauda)
    this.#snapshot = { messages: this.#messages, thread, status: this.#status, error: this.#error }
    for (const listener of this.#listeners) listener()
  }

  /**
   * Emite por JANELA quando o coalescing está ligado; imediatamente quando não está.
   *
   * Borda de saída: o timer emite ao **fim** da janela, com o estado mais recente. O que isto compra
   * não é um emit mais barato — é **menos emits**, e o que pende de cada um é a derivação de 3,274 ms
   * medida no M86.
   *
   * As transições de status (`done`/`error`/`abort`) NÃO passam por aqui: elas chamam `#emit` direto,
   * porque um estado final preso num timer de 16 ms é um estado final perdido se o processo sair antes
   * — e `exec` sai logo após o turno.
   */
  #agendarEmit(): void {
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
      await consumeChunkStream(stream, (message) => {
        if (aborted()) return
        // The SDK leaves the assistant message id empty — fabricate a stable per-turn id so every chunk
        // upserts into the SAME message and the committed copy has a collision-free key (M46).
        const stamped = message.id ? message : { ...message, id: this.#currentAssistantId }
        this.#upsert(stamped)
        // O ÚNICO ponto por delta de token — todos os outros `#emit` deste arquivo são transições de
        // status, e essas nunca esperam timer (ADR-2).
        this.#agendarEmit()
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
      // Invalidação NA ESCRITA (ADR-3): este é um dos dois únicos pontos que mexem em `#committed`.
      this.#prefixo = this.#committed
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
    // O outro ponto de escrita. Sem isto o `reset()` serviria o prefixo velho — e comprimento igual
    // com conteúdo diferente é exatamente o caso que uma memoização por tamanho não pegaria.
    this.#prefixo = this.#committed
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
