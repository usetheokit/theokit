import type { TheoErrorEnvelope } from '../../core/contracts/error-envelope.js'

/**
 * G5 T1.3 — formatError hook signature (blueprint ADR D3).
 *
 * Type-inferred functional transformer that runs at framework error-boundary
 * time. Producer-side analog of trpc's `errorFormatter`. The return type is
 * `TheoErrorEnvelope<TExt>` for arbitrary `TExt` so the inference flows into
 * `@theo/client` codegen + UI consumers.
 */
export interface FormatErrorContext {
  readonly route?: string
  readonly action?: string
  readonly agentRunId?: string
}

export type FormatErrorHook = (
  envelope: TheoErrorEnvelope,
  ctx: FormatErrorContext,
) => TheoErrorEnvelope
