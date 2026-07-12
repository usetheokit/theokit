import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

import { responseToChunkStream } from './consume-ui-message-stream.js'
import type { AgentTransport, ApprovalDecision } from './transport.js'

/** Extra request headers — a static record OR a resolver called per request (for dynamic auth). */
export type HeadersResolver = Record<string, string> | (() => Record<string, string> | undefined)

export interface HttpTransportOptions {
  /** Agent endpoint path or URL, e.g. `/api/agents/support`. */
  api: string
  /**
   * Extra request headers (e.g. auth). Static record OR a resolver evaluated on EVERY request — pass a
   * resolver when the value is dynamic (a rotating JWT), so a stale header is never sent. Merged UNDER
   * per-request headers.
   */
  headers?: HeadersResolver
  /** Override fetch (primarily for tests / non-browser hosts) — static; resolved once at construction. */
  fetch?: typeof fetch
}

/** Normalize `ai`'s `Record | Headers | undefined` header option into a plain record. */
function toRecord(headers: Record<string, string> | Headers | undefined): Record<string, string> {
  if (headers === undefined) return {}
  if (headers instanceof Headers) return Object.fromEntries(headers.entries())
  return headers
}

/**
 * M41 (ADR-0050 D3) — `ChatTransport` over the web agent path.
 *
 * - `sendMessages`: `POST <api>` with the UIMessageStream `accept` + the `X-Theo-Action` CSRF header
 *   (HTTP method + headers are identical to the pre-M41 `useAgent` fetch; the body shape is a superset —
 *   `{ ...input, messages: [UIMessage] }` — which the server's dual-path parser accepts, so no
 *   regression), captures the server-minted `x-theokit-run-id`, and returns `ReadableStream<UIMessageChunk>`
 *   via `ai`'s own SSE parser (`responseToChunkStream`).
 * - `reconnectToStream`: `GET <api>/runs/<runId>/stream` (M37 durable transport); 404 → `null` (the run
 *   completed / was evicted). A caller may pass a `Last-Event-ID` header to resume only the tail; by
 *   default the server replays the run from the start and the client upserts by message id (idempotent).
 * - `approve`: `POST <api>/approve/<id>` (out-of-band HITL settle).
 *
 * Implemented directly (not by subclassing `DefaultChatTransport`) because reconnect keys on our
 * server-minted `runId` captured from a response header, which the base class does not expose — see
 * ADR-0050 D3.
 */
export class HttpTransport implements AgentTransport {
  readonly #api: string
  readonly #headers: HeadersResolver
  readonly #fetch: typeof fetch
  /** Server-minted id of the last run (from `x-theokit-run-id`) — the reconnect key. */
  #lastRunId: string | undefined

  constructor(options: HttpTransportOptions) {
    this.#api = options.api
    this.#headers = options.headers ?? {}
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  /** Resolve the configured headers per request (a resolver evaluates now — dynamic auth is never stale). */
  #resolveHeaders(): Record<string, string> {
    return (typeof this.#headers === 'function' ? this.#headers() : this.#headers) ?? {}
  }

  async sendMessages(
    options: Parameters<ChatTransport<UIMessage>['sendMessages']>[0],
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal, headers, body } = options
    // Only spread an object body (never a primitive — that would emit char-indexed keys). `body` is typed
    // `object | undefined` (ai's `ChatRequestOptions`), so no cast is needed — the guard narrows to
    // `object`. (A runtime-`null` body, which the type forbids, spreads to `{}` — harmless.) The server
    // accepts `{ messages }` (ai shape) AND `{ ...input }` (typed input), preferring the turn text.
    const extra = typeof body === 'object' ? body : undefined
    const response = await this.#fetch(this.#api, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'X-Theo-Action': '1',
        ...this.#resolveHeaders(),
        ...toRecord(headers),
      },
      body: JSON.stringify({ ...extra, messages }),
      signal: abortSignal,
    })
    if (!response.ok) {
      throw new Error(
        `Agent request to ${this.#api} failed: ${response.status} ${response.statusText}`,
      )
    }
    this.#lastRunId = response.headers.get('x-theokit-run-id') ?? undefined
    return responseToChunkStream(response)
  }

  async reconnectToStream(
    options: Parameters<ChatTransport<UIMessage>['reconnectToStream']>[0],
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    if (this.#lastRunId === undefined) return null
    const response = await this.#fetch(`${this.#api}/runs/${this.#lastRunId}/stream`, {
      method: 'GET',
      headers: { ...this.#resolveHeaders(), ...toRecord(options.headers) },
    })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(
        `Agent reconnect to run ${this.#lastRunId} failed: ${response.status} ${response.statusText}`,
      )
    }
    return responseToChunkStream(response)
  }

  async approve(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const response = await this.#fetch(`${this.#api}/approve/${approvalId}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Theo-Action': '1',
        ...this.#resolveHeaders(),
      },
      body: JSON.stringify(decision),
    })
    if (!response.ok) {
      throw new Error(`Approve ${approvalId} failed: ${response.status} ${response.statusText}`)
    }
  }
}
