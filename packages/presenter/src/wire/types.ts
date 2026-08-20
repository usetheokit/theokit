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

/**
 * The outstanding HITL decision a tool part carries while it sits in `state: 'approval-requested'`
 * (usetheokit/theokit#392).
 *
 * Declared rather than left to the part's index signature because `id` is an ARGUMENT — it is what
 * `approve(approvalId, …)` takes — and a caller reading it off `unknown` has to assert a string it
 * cannot check. The other two are optional because the ai-sdk's own frame carries neither, and this
 * wire is readable by an ai-sdk server as well as ours.
 *
 * The tool's name and its resolved input are NOT here: they live on the part itself, put there by
 * the `tool-input-available` chunk under the same `toolCallId`. One fact, one field.
 */
export interface WireToolApproval {
  /** The id `approve()` settles. Distinct from the part's `toolCallId` by contract, equal in practice. */
  readonly id: string
  /** The question the agent's author declared for the human, when the producer sent one. */
  readonly question?: string
  /** How long the gate waits before it settles itself, in ms. Absent means the producer said nothing. */
  readonly timeoutMs?: number
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
