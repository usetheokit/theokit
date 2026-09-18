import { PermissionEngine, PermissionPlugin } from '@theokit/sdk'
import type { PermissionRule } from '@theokit/sdk'
import type { Plugin } from '@theokit/sdk'

/**
 * What an `ask` verdict resolves to, and who decides it.
 *
 * MANDATORY, and that is the whole of the #826 fix rather than a detail of it. `PermissionEngine`
 * answers `ask` for a tool no rule matches, and `PermissionPlugin.create` turns that into a hard
 * block when no gate is supplied:
 *
 *     opts.onAsk ? opts.onAsk(name) : { block: true, message: `requires approval: ${name}` }
 *
 * So an absent gate is not "no opinion" — it is the most restrictive opinion available, applied to
 * every tool the operator did not enumerate, and applied silently.
 *
 * The absence being unrepresentable is the point. `approval-posture.ts`, in this same package,
 * already refuses this shape in writing: "the 'no HITL' posture was not representable as a value, so
 * it was expressed as ABSENCE — and an absence has no exhaustive match, appears in no log, and fails
 * no test." A caller that wants everything unmatched to run says so with a gate that allows; what
 * stops existing is the omission.
 */
export interface PermissionsPluginOptions {
  /**
   * Consulted ONLY on an `ask` verdict — an explicit `allow` never reaches it, and an explicit
   * `deny` is immune to it. May be asynchronous, so a surface with a human can await the decision.
   */
  readonly onAsk: (
    toolName: string,
    input: unknown,
  ) =>
    | { readonly behavior: 'allow' }
    | { readonly behavior: 'deny'; readonly message?: string }
    | Promise<
        { readonly behavior: 'allow' } | { readonly behavior: 'deny'; readonly message?: string }
      >
}

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
 * ## What wiring it cost before the gate was mandatory
 *
 * Enforcing the rules without deciding the `ask` verdict traded one defect for a worse one. Measured
 * on the built binary the same day, with a single project rule allowing `Read(./src/**)`: `skill_read`
 * came back "Plugin blocked this tool call: requires approval: `skill_read`" for a skill that loads
 * correctly, and adding `"allow":["skill_read"]` made the identical call return the skill body.
 * Delegation died the same way — which is why the symptom was first filed as a delegation defect
 * (#828) and as a plugin-bundled-skill defect (#826), and was neither.
 *
 * An allow-list had silently become a whitelist-or-die: the moment an operator wrote any `permissions`
 * block, every tool they had not enumerated stopped working, with no diagnostic naming the cause.
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
export function createPermissionsPlugin(
  rules: readonly PermissionRule[],
  options: PermissionsPluginOptions,
): Plugin | undefined {
  if (rules.length === 0) return undefined
  // `PermissionEngine` keeps its own explicit-deny-wins rule, and nothing here re-decides it. What is
  // decided here is only the verdict the engine leaves open: `ask`, which has no answer of its own.
  return PermissionPlugin.create(new PermissionEngine([...rules]), {
    canUseTool: (toolName, input) => options.onAsk(toolName, input),
  })
}
