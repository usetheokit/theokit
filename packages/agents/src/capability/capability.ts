import { isDeepStrictEqual } from 'node:util'

import type { CompiledAgentOptions } from '../bridge/agent-compiler.js'

/**
 * M52 — the capability layer: object-oriented, composable authoring that produces the EXISTING narrow
 * waist (`CompiledAgentOptions`), which `assembleM8CreateOptions` already turns into `Agent.create`
 * options. No new spec and no new adapter were invented (ADR-1/ADR-2) — a third representation would be
 * the very duplication this initiative removes.
 */

/** Which capability contributed which fields — makes the wiring inspectable as DATA. */
export interface ProvenanceEntry {
  readonly capability: string
  readonly contributed: readonly string[]
}

/** The mutable draft a capability enriches. `tools`/`agents` are pre-seeded (required in the waist). */
export interface CompiledAgentOptionsDraft extends Partial<
  Omit<CompiledAgentOptions, 'tools' | 'agents'>
> {
  tools: CompiledAgentOptions['tools']
  agents: CompiledAgentOptions['agents']
  readonly provenance: ProvenanceEntry[]
}

/**
 * **Strategy + value-level Decorator.** N independent ways to enrich an agent (model, tools, skills,
 * MCP, HITL…), added or removed without touching the builder — a central `switch` would violate OCP.
 */
export interface Capability {
  /** Stable identity — used for provenance and conflict messages. */
  readonly name: string
  apply(draft: CompiledAgentOptionsDraft): void
}

/** Two capabilities set the same scalar field to different values — a composition bug, never last-wins. */
export class CapabilityConflictError extends Error {
  override readonly name = 'CapabilityConflictError'
  constructor(field: string, previous: unknown, next: unknown, capability: string) {
    super(
      `capability "${capability}": campo "${field}" já declarado como ${JSON.stringify(previous)} ` +
        `e redeclarado como ${JSON.stringify(next)} — declare uma vez só.`,
    )
  }
}

/**
 * A fresh draft. `stream` is deliberately NOT seeded: a pre-seeded value would make
 * `setOnce(draft, 'stream', false, …)` throw a conflict against a default nobody declared, so
 * `stream: false` would be structurally unreachable. The default is applied at finalize instead.
 */
export function createDraft(): CompiledAgentOptionsDraft {
  return { tools: [], agents: {}, provenance: [] }
}

/** A draft that has been finalized — the waist's required `stream` is settled. */
export type FinalizedDraft = CompiledAgentOptionsDraft & { stream: boolean }

/** Apply capabilities in declaration order (deterministic) and return the draft. */
export function applyCapabilities(
  capabilities: readonly Capability[],
  draft: CompiledAgentOptionsDraft = createDraft(),
): FinalizedDraft {
  for (const c of capabilities) c.apply(draft)
  draft.stream ??= true // same default the reference compiler emits
  return draft as FinalizedDraft
}

/** Set a scalar exactly once — fail-fast on a conflicting redeclaration (Rule 8). */
export function setOnce<K extends keyof CompiledAgentOptionsDraft>(
  draft: CompiledAgentOptionsDraft,
  field: K,
  value: CompiledAgentOptionsDraft[K],
  capability: string,
): void {
  const previous = draft[field]
  // DEEP equality, never reference identity: two capabilities may legitimately build the SAME
  // logical value in separate objects (`compileSkillsSelection` returns a fresh object per call),
  // and `previous !== value` would report those as a conflict that does not exist.
  if (previous !== undefined && !isDeepStrictEqual(previous, value)) {
    throw new CapabilityConflictError(field, previous, value, capability)
  }
  draft[field] = value
  draft.provenance.push({ capability, contributed: [field] })
}
