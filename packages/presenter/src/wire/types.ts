import type { WireChunk } from './chunk-schema.js'

/**
 * The public shape of a reconstructed message and of a transport, owned by TheoKit.
 *
 * These mirror `ai`'s `UIMessage` / `ChatTransport` structurally — measured: the ai-sdk declarations
 * carry no brands (`index.d.ts:1798` and `:5350`; every `unique symbol` in that file sits at 3149+,
 * after both), so a faithful mirror is assignment-compatible and a consumer that still types against
 * `ai` keeps compiling.
 *
 * The compatibility we OWE is one-directional: our concrete transports must satisfy
 * `ChatTransport`. Demanding equivalence in both directions would be unachievable by construction —
 * we deliberately mirror only the subset TheoKit speaks, so our type has fewer members.
 */

export type WireMessageRole = 'system' | 'user' | 'assistant'

/** A reconstructed part. Open by design: the `data-*` family and future part kinds ride here. */
export interface WireMessagePart {
  readonly type: string
  readonly [key: string]: unknown
}

export interface WireMessage<METADATA = unknown> {
  id: string
  role: WireMessageRole
  metadata?: METADATA
  parts: WireMessagePart[]
}

/**
 * The transport seam. Supersedes the use of `ai`'s `ChatTransport` as our published interface
 * (ADR-0050 D1 said "do NOT invent a parallel interface" — this plan reverses that deliberately).
 */
export interface WireTransport<M extends WireMessage = WireMessage> {
  sendMessages(options: WireSendOptions<M>): Promise<ReadableStream<WireChunk>>
  reconnectToStream(options: WireReconnectOptions): Promise<ReadableStream<WireChunk> | null>
}

/**
 * `headers` is typed rather than swallowed by the index signature.
 *
 * The catch-all `[key: string]: unknown` widens every named field to `unknown` for a consumer that
 * spreads it, which broke `HttpTransport`'s header merge at compile time. Naming the fields the
 * transports actually read keeps them typed; the index signature stays for the per-request extras
 * the request-context work (ADR-0052) passes through.
 */
export type WireHeaders = Record<string, string> | Headers

export interface WireSendOptions<M extends WireMessage = WireMessage> {
  readonly chatId: string
  readonly messages: M[]
  readonly abortSignal?: AbortSignal
  readonly headers?: WireHeaders
  readonly body?: unknown
  readonly metadata?: unknown
  readonly [key: string]: unknown
}

export interface WireReconnectOptions {
  readonly chatId: string
  readonly headers?: WireHeaders
  readonly [key: string]: unknown
}
