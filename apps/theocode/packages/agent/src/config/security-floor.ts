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
 * B-097 — the RULE lives in `@theokit/agents`; what stays here is the VOCABULARY. Which values
 * count as more permissive, which layers may only tighten, and which one is the operator's override
 * are this product's words and belong to this product. The framework owns "a lower-trust layer may
 * confine and never widen", which is the part every agent product rebuilds identically.
 */
import type { SecurityFloorSpec } from '@theokit/agents/config'

/** Each vocabulary ordered from most confined to least. Index = permissiveness. */
export const MORE_PERMISSIVE = {
  sandbox_mode: ['read-only', 'workspace-write', 'danger-full-access'],
  approval_policy: ['untrusted', 'on-request', 'never'],
} as const

type SecurityKey = keyof typeof MORE_PERMISSIVE

/** Layers that may only tighten the user's choice. */
const CANNOT_LOOSEN = ['project', 'project_local', 'profile', 'env'] as const

/** The layer that wins outright in both directions — the operator's explicit flag. */
const OPERATOR_OVERRIDE = 'cli'

/** The same vocabulary as the `floors` declaration `defineLayeredConfig` takes. */
export const SECURITY_FLOORS = {
  sandbox_mode: floorFor('sandbox_mode'),
  approval_policy: floorFor('approval_policy'),
}

function floorFor(key: SecurityKey): SecurityFloorSpec {
  return {
    permissiveness: MORE_PERMISSIVE[key],
    restricted: CANNOT_LOOSEN,
    override: OPERATOR_OVERRIDE,
  }
}
