import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { extractLastUserText } from './last-user-text.js'
import type { AgentTransport, ApprovalDecision } from './transport.js'

/** Handlers the transport hands to the injected push source for one turn. */
export interface ChannelTurnHandlers {
  /** One pushed JSONL line (a serialized `UIMessageChunk`). */
  onLine: (line: string) => void
  /** The turn ended — no more lines. */
  onClose: () => void
  /** The push source failed. */
  onError?: (err: unknown) => void
}

/**
 * The injected push source — a Tauri `Channel`/`invoke` bridge, kept STRUCTURAL so core adds no
 * `@tauri-apps/*` dependency and the transport is testable with a fake (ADR-0051 D2). The Tauri app
 * wires it: `new Channel()`, `channel.onmessage = onLine`, `invoke('run_agent', { message, channel })`,
 * returning a teardown that aborts the sidecar turn.
 */
export interface ChannelPushSource {
  /** Start a turn; deliver each JSONL `UIMessageChunk` line to `onLine`, then `onClose`. Return a teardown. */
  start(turn: { message: string }, handlers: ChannelTurnHandlers): () => void
  /** Optional HITL settle (another Tauri `invoke`). */
  settle?(approvalId: string, decision: ApprovalDecision): Promise<void>
}

export interface ChannelTransportOptions {
  source: ChannelPushSource
}

/**
 * M42 (ADR-0051) — `ChatTransport` over a Tauri-`Channel`-shaped push source, for the desktop webview.
 *
 * - `sendMessages`: start the turn via the injected source and bridge its pushed JSONL frames into a
 *   `ReadableStream<UIMessageChunk>` (built in `start` — a Channel is push, so the stream's queue buffers
 *   frames; ADR-0051 D3). A malformed JSONL line is SKIPPED, never fatal (ADR-0051 D4, Rule 8). `abortSignal`
 *   tears down the source and closes the stream.
 * - `reconnectToStream`: always `null` — the M36 sidecar runs the turn directly (no durable server stream);
 *   this is the honest parity for a single-process push surface (ADR-0051 D5; mirrors `InProcessTransport`).
 * - `approve`: routes to the injected `settle` (another Tauri `invoke`); absent `settle` → a typed error.
 *
 * The push source is INJECTED — core stays Tauri-agnostic and this transport is unit-tested with a fake.
 */
export class ChannelTransport implements AgentTransport {
  readonly #source: ChannelPushSource

  constructor(options: ChannelTransportOptions) {
    this.#source = options.source
  }

  sendMessages(
    options: Parameters<ChatTransport<UIMessage>['sendMessages']>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal } = options
    const message = extractLastUserText(messages)
    const source = this.#source

    // Per-stream teardown/abort-detach, hoisted so `cancel` (consumer stops reading) can also tear the
    // source down. `closed` makes every terminal transition idempotent (no enqueue/close after close).
    let closed = false
    let teardown: () => void = () => undefined
    let detachAbort: () => void = () => undefined

    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        const finish = (settle: () => void): void => {
          if (closed) return
          closed = true
          detachAbort()
          settle()
        }
        teardown = source.start(
          { message },
          {
            onLine: (line) => {
              if (closed) return
              // Skip a malformed pushed line — one bad frame must never crash the webview (ADR-0051 D4).
              let parsed: unknown
              try {
                parsed = JSON.parse(line)
              } catch {
                return
              }
              // Discriminant guard: a `UIMessageChunk` is an object with a string `type`. The trust
              // boundary here is the LOCAL sidecar (not the network), so a discriminant check — not the
              // full `ai` schema (which isn't exposed standalone) — is proportionate: it rejects
              // structureless / wrong-shape payloads before they reach `readUIMessageStream`. Same
              // skip-not-crash policy as a parse error.
              if (
                typeof parsed !== 'object' ||
                parsed === null ||
                typeof (parsed as { type?: unknown }).type !== 'string'
              ) {
                return
              }
              controller.enqueue(parsed as UIMessageChunk)
            },
            onClose: () => {
              finish(() => {
                controller.close()
              })
            },
            onError: (err) => {
              finish(() => {
                controller.error(err)
              })
            },
          },
        )
        if (abortSignal !== undefined) {
          const onAbort = (): void => {
            finish(() => {
              teardown()
              controller.close()
            })
          }
          if (abortSignal.aborted) onAbort()
          else {
            abortSignal.addEventListener('abort', onAbort)
            detachAbort = () => {
              abortSignal.removeEventListener('abort', onAbort)
            }
          }
        }
      },
      cancel() {
        // The consumer stopped reading (reader.cancel) — abort the source turn + drop the abort listener.
        if (closed) return
        closed = true
        detachAbort()
        teardown()
      },
    })
    return Promise.resolve(stream)
  }

  reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return Promise.resolve(null)
  }

  async approve(approvalId: string, decision: ApprovalDecision): Promise<void> {
    if (this.#source.settle === undefined) {
      throw new Error(`This channel source has no HITL settle — cannot approve '${approvalId}'.`)
    }
    await this.#source.settle(approvalId, decision)
  }
}
