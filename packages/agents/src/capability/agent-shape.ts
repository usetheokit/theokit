import type { CompiledTool } from '../bridge/agent-compiler.js'
import type { ReasoningEffort } from '../types.js'

import { applyCapabilities, type Capability, type ProvenanceEntry } from './capability.js'

/**
 * M69 — the composed shape of an agent, as a value the construction sites can consume.
 *
 * ## What this replaces
 *
 * `applyCapabilities` returns a `FinalizedDraft`: `Partial<CompiledAgentOptions>` plus a MUTABLE
 * `provenance` array. That is the compiler's working surface — exactly right for capabilities,
 * which enrich it in place — and it was also the only thing the capability layer handed back.
 *
 * So a caller that wanted the small answer ("which tools does this agent have, on which model, and
 * who declared them?") had to depend on the entire compiled-options shape and receive an array it
 * could push into. The three construction sites — the `AgentBuilder`, `Agent.create`, and roles
 * loaded from disk — all need that same answer, and none of them should be handed the draft to get
 * it.
 *
 * ## Why four fields
 *
 * `{ tools, model, reasoningEffort, provenance }` is what a caller composes and reasons about: what
 * the agent can do, on which model, at what effort, and where each of those came from. Everything
 * else in the compiled options is downstream projection. Publishing the narrow value is what keeps
 * the wide internal one free to change — the reason it was internal in the first place.
 *
 * `provenance` is what makes the shape auditable rather than merely descriptive: two capabilities
 * may both touch `tools`, and without it a reader cannot tell which one to go edit.
 */
export interface AgentShape {
  /** Identity of the agent this shape describes. */
  readonly name: string
  /**
   * Tools the composed capabilities contributed, in declaration order.
   *
   * `readonly CompiledTool[]`, not the draft's own `CompiledTool[]`: inheriting the draft's type
   * would publish a MUTABLE array, which is the half of the problem this value exists to fix. The
   * draft is mutable because capabilities enrich it in place; what the construction sites receive
   * must not be.
   */
  readonly tools: readonly CompiledTool[]
  /** Model id, when some capability declared one. */
  readonly model?: string
  /** Extended-thinking effort, when declared. */
  readonly reasoningEffort?: ReasoningEffort
  /** Which capability contributed which field. */
  readonly provenance: readonly ProvenanceEntry[]
}

/**
 * Compose `members` into a published {@link AgentShape}.
 *
 * A projection of `applyCapabilities`, never a second implementation — so it inherits the set-once
 * discipline: a conflicting redeclaration still throws `CapabilityConflictError` rather than
 * resolving silently. A narrower return type that swallowed the conflict would be a downgrade
 * disguised as ergonomics.
 *
 * The result is frozen, including its arrays. The draft is mutable by design; the published value
 * must not be, or the shape becomes a shared mutable and the next reader cannot tell whether what
 * they hold is what was declared.
 */
export function declareAgentShape(name: string, members: readonly Capability[]): AgentShape {
  const draft = applyCapabilities(members)
  // The optional fields are SPREAD IN when present rather than assigned `undefined`. Under
  // `exactOptionalPropertyTypes` those are different things, and the difference is meaningful here:
  // `{ model: undefined }` says "a capability declared no model", which is indistinguishable from
  // "somebody set it to nothing". An absent key says only the first.
  const shape: AgentShape = {
    name,
    tools: Object.freeze([...draft.tools]),
    provenance: Object.freeze([...draft.provenance]),
    ...(draft.model !== undefined && { model: draft.model }),
    ...(draft.reasoningEffort !== undefined && { reasoningEffort: draft.reasoningEffort }),
  }
  return Object.freeze(shape)
}
