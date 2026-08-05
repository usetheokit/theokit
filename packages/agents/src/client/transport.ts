import type { ChatTransport, UIMessage } from 'ai'

/**
 * M41 (ADR-0050 D2) — a HITL approval decision sent to settle a paused gated-tool call. Mirrors the
 * `POST /api/agents/<name>/approve/<id>` wire body (`approve-agent.ts` `parseApprovalBody`). Defined
 * on the client side (not imported from `server/`) as the client's view of the boundary contract.
 */
export interface ApprovalDecision {
  /** Whether the paused gated tool may proceed. */
  approved: boolean
  /** Optional reason surfaced to the model on denial. */
  reason?: string
  /** Optional small structured note (edited args, a reviewer comment) — capped server-side at 16 KiB. */
  payload?: unknown
}

/**
 * M43 (ADR-0052) — per-request context attached uniformly across every transport.
 *
 * `headers` is the serializable, HTTP-native half (an auth token → request headers on `HttpTransport`);
 * `metadata` is the structured, same-process half forwarded to the in-process runner
 * (`InProcessTransport`) / the Tauri `invoke` (`ChannelTransport`). Threaded through the seam's existing
 * `ChatRequestOptions` — NOT a new channel. The turn input stays the request `body`.
 */
export interface RequestContext {
  /** Per-request headers (e.g. auth). HTTP-native; mapped to request headers by `HttpTransport`. */
  headers?: Record<string, string>
  /** Structured per-request context (tenant, provider, …) forwarded to in-process / channel runners. */
  metadata?: unknown
}

/**
 * M41 (ADR-0050 D1/D2) — the client transport seam.
 *
 * It IS `ai`'s `ChatTransport<UIMessage>` (the adopted SOTA interface — we do NOT invent a parallel
 * one) plus ONE optional method, `approve`, for TheoKit's OUT-OF-BAND HITL (the server pauses the run;
 * the client settles it via a separate call). `ai`'s `ChatTransport` has no `approve` because its HITL
 * is in-band (a re-sent message part); ours is out-of-band, and the settle route differs per transport
 * (HTTP `POST /approve/<id>` vs an inline callback), so it belongs on the transport. `approve` is
 * optional — agents without gated tools never settle an approval.
 *
 * `HttpTransport` (web) and `InProcessTransport` (TUI/desktop) implement this; `useAgent` drives it.
 */
export type AgentTransport = ChatTransport<UIMessage> & {
  approve?(approvalId: string, decision: ApprovalDecision): Promise<void>
}
