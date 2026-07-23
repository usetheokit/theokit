import type { UIMessageChunk } from 'ai'

import type { AgentOutputEvent } from '../agent-output-event.js'
import type { Presenter } from '../presenter.js'

/**
 * `UIMessageStreamPresenter` (M49) — the web surface: the canonical {@link AgentOutputEvent} → the Vercel
 * ai-sdk `UIMessageStream` (`UIMessageChunk`), consumed by `useChat` / assistant-ui.
 *
 * Ported faithfully from `@theokit/agents/bridge/ui-message-stream-translator.ts` (the M1 web path) with
 * ZERO behavior change for the pure-output events. Framework chunks (HITL `tool-approval-request`,
 * `data-checkpoint`) are NOT emitted here — they ride on `@theokit/agents` framework events and are
 * composed by the agents web handler around this presenter (ADR-4).
 *
 * STATEFUL (open-block state machine) → instantiate ONE per stream. The host brackets the stream with
 * {@link start} / {@link finish} and drives {@link present} per event, interleaving framework chunks.
 *
 * Chunk sequences (unchanged):
 *   text run:      start → text-start{id} → text-delta{id,delta}* → text-end{id} → finish
 *   reasoning run: start → reasoning-start{id} → reasoning-delta{id,delta}* → reasoning-end{id} → finish
 *   tool run:      start → tool-input-available{callId,name,input} → tool-output-available{callId,output} → finish
 *
 * @public
 */
export interface TurnMetadata {
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly totalTokens?: number
  }
  readonly durationMs?: number
  readonly cost?: number
}

export interface UIMessageStreamPresenterOptions {
  /** A single shared id for every text block — injected for deterministic tests (D3). */
  readonly textId: string
}

export class UIMessageStreamPresenter implements Presenter<UIMessageChunk> {
  readonly surface = 'ui-message-stream'
  readonly #textId: string
  #openBlock: 'text' | 'reasoning' | null = null
  #reasoningId: string | null = null
  readonly #seen = new Set<string>()

  constructor(options: UIMessageStreamPresenterOptions) {
    this.#textId = options.textId
  }

  /** Emit the opening `start` chunk (exactly once, before any event). */
  start(): UIMessageChunk[] {
    return [{ type: 'start' }]
  }

  present(event: AgentOutputEvent): UIMessageChunk[] {
    switch (event.type) {
      case 'text':
        return this.#emitTextDelta(event.text)
      case 'reasoning':
        return this.#emitReasoningDelta(event.text)
      case 'tool-call':
        return [
          ...this.#closeOpenBlock(),
          ...this.#emitToolCall(event.callId, event.name, event.input),
        ]
      case 'tool-result':
        return [
          ...this.#closeOpenBlock(),
          ...this.#emitToolResult(event.callId, event.name, event.result, event.isError ?? false),
        ]
      case 'error':
        // Surface the failure as an ai-sdk error chunk (fail-clear); the host stops and calls finish().
        return [{ type: 'error', errorText: event.message }]
      // `partial-tool-call` streams incremental args — the current web path emits no chunk for it
      // (args are shown on the committed `tool-call`); `finish` / `status` are handled by finish()/host.
      default:
        return []
    }
  }

  /**
   * Close any open text/reasoning block and emit the terminal `finish` chunk. When `metadata` is given
   * (a clean run's turn totals from the framework `done`), it rides `messageMetadata`; otherwise the
   * finish is bare (error/abort turns), byte-identical to the original translator.
   */
  finish(metadata?: TurnMetadata): UIMessageChunk[] {
    const out = this.#closeOpenBlock()
    out.push(metadata ? { type: 'finish', messageMetadata: metadata } : { type: 'finish' })
    return out
  }

  // --- internal open-block state machine (verbatim from the original translator) ---

  #closeOpenBlock(): UIMessageChunk[] {
    const out: UIMessageChunk[] = []
    if (this.#openBlock === 'text') {
      out.push({ type: 'text-end', id: this.#textId })
    } else if (this.#openBlock === 'reasoning' && this.#reasoningId) {
      out.push({ type: 'reasoning-end', id: this.#reasoningId })
    }
    this.#openBlock = null
    this.#reasoningId = null
    return out
  }

  #emitTextDelta(content: string): UIMessageChunk[] {
    const out: UIMessageChunk[] = []
    if (this.#openBlock !== 'text') {
      out.push(...this.#closeOpenBlock(), { type: 'text-start', id: this.#textId })
      this.#openBlock = 'text'
    }
    out.push({ type: 'text-delta', id: this.#textId, delta: content })
    return out
  }

  #emitReasoningDelta(content: string): UIMessageChunk[] {
    const out: UIMessageChunk[] = []
    let reasoningId = this.#openBlock === 'reasoning' ? this.#reasoningId : null
    if (reasoningId === null) {
      out.push(...this.#closeOpenBlock())
      reasoningId = crypto.randomUUID()
      this.#reasoningId = reasoningId
      out.push({ type: 'reasoning-start', id: reasoningId })
      this.#openBlock = 'reasoning'
    }
    out.push({ type: 'reasoning-delta', id: reasoningId, delta: content })
    return out
  }

  #emitToolCall(callId: string, name: string, input: unknown): UIMessageChunk[] {
    this.#seen.add(callId)
    return [
      { type: 'tool-input-available', toolCallId: callId, toolName: name, input, dynamic: true },
    ]
  }

  #emitToolResult(
    callId: string,
    name: string,
    result: unknown,
    isError: boolean,
  ): UIMessageChunk[] {
    const out: UIMessageChunk[] = []
    if (!this.#seen.has(callId)) {
      this.#seen.add(callId)
      out.push({
        type: 'tool-input-available',
        toolCallId: callId,
        toolName: name,
        input: {},
        dynamic: true,
      })
    }
    // The canonical tool-result carries a serialized string `result` (from `fromSdk`).
    const output = typeof result === 'string' ? result : ''
    if (isError) {
      out.push({ type: 'tool-output-error', toolCallId: callId, errorText: output })
    } else {
      out.push({ type: 'tool-output-available', toolCallId: callId, output })
    }
    return out
  }
}
