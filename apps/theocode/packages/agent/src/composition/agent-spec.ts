/**
 * B-059 — one place where an agent's shape is declared, for all three construction sites.
 *
 * ## The problem this closes
 *
 * This package builds three agents through routines that do not call one another: `chat.ts`'s
 * fluent chain, `review/create-agent.ts`'s direct `Agent.create`, and `delegation/roles.ts`'s
 * disk-driven one. Each decides its own tool set inline, so a fourth agent had no shape to reuse —
 * only a fourth routine to write. `chat.ts:320` says why the chain could not absorb them: it is
 * fluent, so there is no way to skip a link in the middle of it.
 *
 * ## What this is, and what it deliberately is NOT
 *
 * It declares **what an agent may do** and returns that as a value. It does NOT create the agent.
 * That split is the reason the three sites can adopt it without any of them changing behaviour:
 * each keeps the SDK entry it already uses (`AgentBuilder`, `Agent.create`, `Agent.create`) and
 * merely stops deciding its tool set inline.
 *
 * Reaching further — composing straight through to a running handle — is possible (`toAgentFactory`
 * accepts a draft; measured 2026-08-10) and is deliberately not done here. It would rewrite the
 * review agent's `agentId`/`delete`/dispose lifecycle, which B-043 hardened after a real leak, and
 * this bullet's contract is explicitly "without changing its behaviour".
 *
 * ## Why the framework's capability layer rather than our own composer
 *
 * Parsimony ladder rung 4: `@theokit/agents` already publishes `Capability`, `applyCapabilities`
 * and `CapabilityPreset`, and they are present in the INSTALLED build — verified by execution, not
 * by reading the reference source, which is ahead of its own published dist. Writing a second
 * composer here would be the duplication this item exists to remove.
 *
 * The layer also brings two properties a hand-rolled list would not: `provenance` (which capability
 * contributed which field, inspectable as data) and `CapabilityConflictError` instead of last-wins
 * when two members declare the same scalar differently.
 */
import {
  CapabilityPreset,
  ModelCapability,
  ToolsCapability,
  applyCapabilities,
} from '@theokit/agents'
import type { Capability, CustomTool } from '@theokit/agents'

import type { ReasoningEffort } from '../config/index.js'
import type { ToolRegistry } from '../tools/index.js'

/** What every site already holds before it can decide anything: a resolved registry and a model. */
export interface SpecContext {
  registry: ToolRegistry
  model: string
  reasoning_effort: ReasoningEffort
}

/** The shape an agent was declared to have. A value, not a routine — which is the whole point. */
export interface AgentShape {
  readonly name: string
  readonly tools: readonly CustomTool[]
  readonly model: string
  readonly reasoningEffort: ReasoningEffort
  /** Which capability contributed which field. Inspectable, so composition is auditable as data. */
  readonly provenance: readonly { capability: string; contributed: readonly string[] }[]
}

/**
 * Tools by NAME, resolved through the one registry every path already shares.
 *
 * Names rather than built tools on purpose: a name is what a role file, a hardcoded reviewer list
 * and the chat agent all actually declare, and `ToolRegistry.resolve` fails loud on an unknown one.
 * Passing pre-built tools would move that check out of the one place that owns it.
 */
export function toolsNamed(registry: ToolRegistry, names: readonly string[]): Capability {
  return new ToolsCapability(registry.resolve(names) as never)
}

/**
 * Declare a named agent shape. THIS is the entry the DoD asks the three sites to share.
 *
 * A shape is a list of capabilities, so a fourth agent is a list — not a file beside `chat.ts`.
 * `CapabilityPreset` makes the whole list behave as one capability, so a shape can be included in
 * another shape without spreading arrays at the call site.
 */
export function declareAgent(
  name: string,
  ctx: SpecContext,
  members: readonly Capability[],
): AgentShape {
  const preset = new CapabilityPreset(name, [
    new ModelCapability(ctx.model, ctx.reasoning_effort),
    ...members,
  ])
  const draft = applyCapabilities([preset])
  return {
    name,
    tools: draft.tools as unknown as readonly CustomTool[],
    model: ctx.model,
    reasoningEffort: ctx.reasoning_effort,
    provenance: draft.provenance,
  }
}

/** The tool names the reviewer holds. Its job is to read a diff and report on it. */
export const REVIEWER_TOOLS = ['git_diff', 'read_file', 'grep', 'run_shell'] as const

/**
 * The reviewer, as a list.
 *
 * `review/create-agent.ts` used to state this inline as `REVIEWER_TOOLS` and resolve it against
 * a registry it built itself. It now asks for the shape and hands `shape.tools` to the same
 * `Agent.create` call it always made — identical behaviour, declared in one place.
 */
export function reviewerShape(ctx: SpecContext): AgentShape {
  return declareAgent('reviewer', ctx, [toolsNamed(ctx.registry, REVIEWER_TOOLS)])
}
