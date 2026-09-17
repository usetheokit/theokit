import { PermissionEngine, PermissionPlugin } from '@theokit/sdk'
import type { PermissionRule } from '@theokit/sdk'
import type { Plugin } from '@theokit/sdk'

/**
 * The `permissions` block of a settings file, as a plugin the run enforces.
 *
 * ## Why this exists
 *
 * `permissionRulesFromSettings` has rendered that block into `PermissionRule[]` since it was written,
 * and nothing consumed the result. Measured on 2026-09-17 across the consumer: the field is produced
 * in `settings-json.ts` and read in no other file, so an operator's `deny` was parsed, reported as
 * translated, and dropped.
 *
 * The cost was measured the same day, beside Claude Code on byte-identical configuration: it refused
 * a `Read(./off-limits.txt)` deny rule, and this ecosystem answered with the file's contents.
 *
 * ## Why here rather than in the consumer
 *
 * `PermissionEngine` and `PermissionPlugin` are SDK classes, and a consumer that names them takes a
 * dependency on the SDK's shape for a capability it should be able to ask for by name.
 * `createToolHooksPlugin`, next door, set that precedent.
 *
 * ## Why `undefined` rather than an empty plugin
 *
 * A plugin over an empty rule set is a gate that can only answer yes. Returning `undefined` lets the
 * caller omit it, which keeps "no policy was configured" distinguishable from "a policy that permits
 * everything" — and a diagnostic reading a live gate would report the second as a control in force.
 */
export function createPermissionsPlugin(rules: readonly PermissionRule[]): Plugin | undefined {
  if (rules.length === 0) return undefined
  // `PermissionEngine` keeps its own fail-closed default and its explicit-deny-wins rule; nothing
  // here re-decides either. This is wiring, not policy.
  return PermissionPlugin.create(new PermissionEngine([...rules]))
}
