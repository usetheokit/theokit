/**
 * B-008 — whether the `project` setting source may be enabled.
 *
 * The source is not scoped to one capability. The SDK states in its own typings that enabling
 * `"project"` turns on repository-declared hooks as well as subagent discovery, and a hook is
 * arbitrary command execution on every tool call.
 *
 * TheoCode's own hooks pass a second gate the SDK path does not: a per-hook sha256 fingerprint
 * (`hooks/hook-trust.ts`) whose purpose is catching a hook whose command changed after approval.
 * Gating the source on `subagents` alone therefore left a way to reach command execution that
 * skipped the fingerprint entirely — by declaring the hook where the SDK loads it.
 *
 * So the source requires every capability it enables. Adding one to that list is a deliberate act,
 * which is the point: the previous shape let the source grow new powers without the gate noticing.
 */
import type { TrustPosture } from './trust-posture.js'

export function projectSourceAllowed(allows: { subagents: boolean; hooks: boolean }): boolean {
  return allows.subagents && allows.hooks
}

/** The narrow capability vocabulary the framework's setting-source grant is stated in. */
type ProjectSettingsPosture = {
  readonly level: TrustPosture['level']
  readonly source: TrustPosture['source']
  readonly allows: { readonly projectSettings: boolean }
}

/**
 * M86 — project this repository's trust decision into the framework's vocabulary.
 *
 * `@theokit/agents@8.0.0` stopped taking `.settingSources(['project', 'user'])`. `project` now
 * requires the `TrustPosture` that authorized it, so a downstream refusal can say WHERE the decision
 * came from (`env` / `store` / `default`) instead of only that it was refused.
 *
 * The two vocabularies genuinely differ: the framework declares one capability, `projectSettings`;
 * TheoCode declares several, and this source's gate is the CONJUNCTION of `subagents` and `hooks`
 * (see above). So this is a projection of a decision already made — never a second decision, and
 * never a posture built fresh. Rebuilding one would type-check and would make every refusal claim it
 * came from a `default`, erasing the distinction the `source` field exists to preserve.
 */
export function projectSettingsPosture(posture: TrustPosture): ProjectSettingsPosture {
  return {
    level: posture.level,
    source: posture.source,
    allows: { projectSettings: projectSourceAllowed(posture.allows) },
  }
}
