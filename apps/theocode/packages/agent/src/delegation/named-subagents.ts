import type { SubagentDefinition } from '@theokit/agents'

import { discoverRoles } from './role-discovery.js'

/** The `AgentDefinition` shape `AgentBuilder.subagents()` takes, named here so no cast is needed. */
export interface AgentDefinitionLike {
  readonly description: string
  readonly prompt: string
  readonly model?: string
  readonly tools?: readonly string[]
}

/**
 * Every subagent on disk, as definitions the builder registers — memory included.
 *
 * #825 — `applySubagentMemory` folds a subagent's `MEMORY.md` into its prompt, and `discoverRoles`
 * has returned it enriched since it was wired. Nothing registered the result: the builder loads
 * `.claude/agents/*.md` itself through `settingSources`, straight from the file, so the enriched copy
 * was computed and thrown away for every subagent except the two squad roles.
 *
 * That is why the first fix did not reach the reported case. `buildRoleAgent` threads the prompt, and
 * it is only ever called for `TEAM_ROLES` — `explorer` and `worker`, behind `delegate_to_team`. An
 * operator's own `auditor` never passes through it: it arrives as its own tool, built by the framework
 * from the file. Measured on the built binary 2026-09-17, with the squad path already fixed: asked to
 * quote any canary already in its instructions, the subagent answered "You are an auditor." and not
 * the note sitting in its `MEMORY.md`.
 *
 * Registering them explicitly is what closes it. The definitions here are the SAME ones the framework
 * would read, taken one step later — after the memory is applied — so nothing is invented and nothing
 * is withheld.
 *
 * ## The trust gate is the caller's, not this function's
 *
 * `projectAllowed` decides whether the repository's own `.claude/agents/` is read at all, and it comes
 * from `posture.allows.subagents` — the same gate `settingSourcesFor` applies. An untrusted repository
 * gets the operator's roles and none of its own, exactly as before; this changes what a role CARRIES,
 * never which roles exist.
 */
export async function namedSubagentDefinitions(
  cwd: string,
  projectAllowed: boolean,
): Promise<Record<string, AgentDefinitionLike>> {
  const roles = await discoverRoles({ cwd, projectAllowed })
  const out: Record<string, AgentDefinitionLike> = {}
  for (const [name, def] of Object.entries(roles)) out[name] = definitionFrom(def, name)
  return out
}

/**
 * One role as a builder definition.
 *
 * `prompt` is the whole point — it is the field carrying the memory. `description` is what the model
 * reads when choosing, and a subagent without one is unpickable, so an absent description falls back
 * to the name rather than to an empty string that would render as a nameless option.
 *
 * `sandbox` is deliberately not carried: `AgentDefinition` has no such field, and inventing a mapping
 * for it here would decide a confinement policy in the place that is only meant to preserve a prompt.
 */
function definitionFrom(def: SubagentDefinition, name: string): AgentDefinitionLike {
  return {
    description: def.description !== undefined && def.description !== '' ? def.description : name,
    prompt: def.prompt,
    ...(def.tools !== undefined ? { tools: [...def.tools] } : {}),
  }
}
