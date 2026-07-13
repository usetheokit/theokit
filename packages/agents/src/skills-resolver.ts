/**
 * M13 (theokit-ai-first) — per-request skills resolution (ADR-0040 § D2, home/boundary concern).
 *
 * The static `skills.enabled` filter already works (`compile-skills` maps `include` → the SDK's
 * `enabled`). This adds a PER-REQUEST resolver so multi-tenant apps expose different skill sets to
 * different users. A selection is either a static list or a function of the request context (the M7
 * run-context). Discovery + injection stay in the SDK; this only CHOOSES the enabled set per call.
 */

import type { InlineSkill } from '@theokit/sdk'

/** The request context handed to a skills resolver (the M7 run-context — opaque per-request data). */
export type SkillsRequestContext = Record<string, unknown>

/**
 * How the skill set is chosen:
 * - a static array of `string` (filesystem skill NAMES → `skills.enabled`) and/or `InlineSkill`
 *   objects from `createSkill` (code-defined skills → `skills.inline`, injected into the `<skills>`
 *   block). A mixed list is split at compile time.
 * - a function — resolved per request from the {@link SkillsRequestContext} (sync or async). The
 *   resolver returns filesystem skill NAMES (inline skills are static — declared on the agent).
 */
export type SkillsSelection =
  | readonly (string | InlineSkill)[]
  | ((ctx: SkillsRequestContext) => readonly string[] | Promise<readonly string[]>)

/**
 * Resolve the enabled skill names for a request. Returns `undefined` when no selection is given (the
 * SDK then enables every discovered skill). Fails fast if a resolver returns a non-array. The static
 * array is compiled ahead of time (see `compileSkillsSelection`), so this is exercised for the
 * resolver form; a static array is defensively narrowed to its string (name) members.
 */
export async function resolveEnabledSkills(
  selection: SkillsSelection | undefined,
  ctx: SkillsRequestContext,
): Promise<string[] | undefined> {
  if (selection === undefined) return undefined
  if (typeof selection !== 'function') {
    return selection.filter((s): s is string => typeof s === 'string')
  }
  const resolved = await selection(ctx)
  if (!Array.isArray(resolved)) {
    throw new Error('[@theokit/agents] skills resolver must return an array of skill names')
  }
  return [...resolved]
}
