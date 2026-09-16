/**
 * B-006 — the two config keys that decide confinement do not follow plain last-wins.
 *
 * `sandbox_mode` and `approval_policy` were ordinary scalars, so `project` (precedence 30) and `env`
 * (50) both outranked the user's own file (20): a cloned repository could hand itself
 * `danger-full-access`, and the user's global setting simply lost.
 *
 * The codebase already made this argument once, for `hooks`, and recorded it — an environment
 * variable injecting hooks would be arbitrary code execution declared outside any reviewable file,
 * bypassing the accumulation that stops a project from displacing the user's global guard. The same
 * reasoning applies to these two keys and had not been applied.
 *
 * The floor is narrow on purpose. `project`, `profile` and `env` may only HARDEN. `cli` may still
 * loosen: that is the operator typing an explicit flag for a single session, and the threat model
 * here is a repository or an inherited environment, not the person at the keyboard.
 *
 * B-097 — the RULE now lives in `@theokit/sdk`; what stays here is the VOCABULARY. Which values
 * count as more permissive, which layers may only tighten, and which one is the operator's override
 * are this product's words and belong to this product. The framework owns "a lower-trust layer may
 * confine and never widen", which is the part every agent product rebuilds identically.
 */
import { applySecurityFloor as applyFloor } from '@theokit/agents'

import { LAYERS } from './layers.js'

/** Each vocabulary ordered from most confined to least. Index = permissiveness. */
export const MORE_PERMISSIVE = {
  sandbox_mode: ['read-only', 'workspace-write', 'danger-full-access'],
  approval_policy: ['untrusted', 'on-request', 'never'],
} as const

export type SecurityKey = keyof typeof MORE_PERMISSIVE

/** Layers that may only tighten the user's choice. */
const CANNOT_LOOSEN = ['project', 'project_local', 'profile', 'env'] as const

/** The layer that wins outright in both directions — the operator's explicit flag. */
const OPERATOR_OVERRIDE = 'cli'

export interface LayeredValues {
  defaults?: string | undefined
  user?: string | undefined
  project?: string | undefined
  project_local?: string | undefined
  profile?: string | undefined
  env?: string | undefined
  cli?: string | undefined
}

/**
 * Resolve one security key across layers: last-wins, except that `project`/`profile`/`env` may never
 * choose something more permissive than what a lower layer already established.
 */
export function applySecurityFloor(key: SecurityKey, layers: LayeredValues): string | undefined {
  return applyFloor({
    permissiveness: MORE_PERMISSIVE[key],
    restricted: CANNOT_LOOSEN,
    override: OPERATOR_OVERRIDE,
    // Built by walking `LAYERS` rather than from an object literal: the framework takes the
    // unrestricted layers in the order given, so the baseline (`user` beats `defaults`) depends on
    // key order. Deriving it from the declared chain states that dependency once, next to the
    // precedences it comes from, instead of resting on how someone happened to type a literal.
    layers: Object.fromEntries(LAYERS.map(({ layer }) => [layer, layers[layer]])),
  })
}
