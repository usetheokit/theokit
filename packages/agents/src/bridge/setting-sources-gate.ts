import type { SettingSource, TrustPosture } from '@theokit/sdk'
import { TheokitAgentError } from '@theokit/sdk/errors'

/**
 * M68 — the trust gate for `settingSources`.
 *
 * ## The defect this module closes
 *
 * `settingSources` enables on-disk config discovery. `'user'` reads `~/.theokit/` — the operator's
 * own machine, which no third party controls. `'project'` reads `<cwd>/.theokit/`, **including
 * `hooks.json`, which executes shell**.
 *
 * The previous API took `readonly SettingSource[]`, and its JSDoc justified the risk this way:
 * *"it is opt-in because `.theokit/` is the app's own repo (informed consent)"*. That premise holds
 * for a web app whose `cwd` is its own deploy. It does **not** hold for the class of product this
 * framework addresses — an agent whose `cwd` is a repository the user just cloned. There `.theokit/`
 * is attacker-controlled content, and enabling `'project'` is remote code execution on the first
 * `build()`.
 *
 * Documenting it did not prevent it. The measured consumer (TheoCode) did not trust the API: it
 * gated from the outside, with a `posture.allows` of its own (`chat.ts:386`, comment B-008). It
 * already **had** the right decision and could not pass it through, because the API only accepted
 * strings. The gate existed on its side and evaporated at the boundary.
 *
 * ## The evidence is the SDK's, not one invented here
 *
 * `TrustPosture` is `@theokit/sdk`'s own trust primitive, and `recordWiring`'s doc says *"a posture
 * is the only thing in this package that retains a capability"*. A bespoke type would make two trust
 * grammars coexist and drift apart (ADR 0063).
 */

/**
 * The framework's capability vocabulary — deliberately a single name (ADR 0065).
 *
 * `allows` is all-or-nothing in the SDK: every declared `K` gets the same boolean. A finer
 * vocabulary (`hooks`, `skills`, `subagents`, `mcp`) would promise the consumer it can gate one
 * without gating the other, and the primitive does not deliver that. An API that suggests a
 * distinction the runtime does not make teaches the wrong thing, and the error only surfaces when
 * somebody depends on the distinction.
 */
export type SettingSourceCapability = 'projectSettings'

/** Authorization to read config from the working directory. Requires the posture, never a claim. */
export interface ProjectSettingsGrant {
  /**
   * Typically the output of `resolveTrustPosture` — which is what gives it `source` (`'env' |
   * 'store' | 'default'`) and therefore a refusal that says WHERE the decision came from instead of
   * merely denying.
   */
  readonly trustedBy: TrustPosture<SettingSourceCapability>
}

/**
 * Which on-disk config roots the agent may read.
 *
 * The asymmetry is the design: `user` is a boolean because `~/.theokit/` belongs to the operator;
 * `project` requires evidence because `<cwd>/.theokit/` may not. Omitting a root is not enabling it
 * — never "enabling without a gate". The asymmetry is inherited from the SDK itself, whose
 * `TrustPostureInput.envOverride` documents that `false` and `undefined` both mean "the operator did
 * not turn it on", not "turned it off".
 */
export interface SettingSourcesSelection {
  /** `~/.theokit/` — the operator's machine. No gate: no third party controls it. */
  readonly user?: boolean
  /** `<cwd>/.theokit/` — controlled by whoever wrote the open repository. Requires evidence. */
  readonly project?: ProjectSettingsGrant
  /**
   * `<cwd>/.claude/` — a FOREIGN configuration dialect, read only once declared
   * (`usetheokit/theokit-sdk#524`).
   *
   * ## Two questions, and which half of this field answers each
   *
   * The SDK's docblock separates them, and the separation is the whole point of `compatSources`:
   * a trust gate answers *"do I trust the code in this directory?"*; importing another product's
   * configuration answers *"do I want it imported into this one?"*. They come apart in the ordinary
   * case, because `.claude/` is populated in exactly the repository one trusts most — for a
   * different tool, by a teammate who never heard of this runtime.
   *
   * So the two are answered by two different things here, and it matters which:
   *
   * | Question | Answered by |
   * |---|---|
   * | do I want the foreign dialect imported? | **declaring this field at all** — omitting is not enabling |
   * | do I trust this directory's code to run? | the `TrustPosture` inside the grant |
   *
   * ## Why the grant is `ProjectSettingsGrant` and not a vocabulary of its own
   *
   * Not because the two questions are the same — they are not. Because a separate grant could not
   * carry the distinction even if it existed: `TrustPosture.allows` is `Record<K, boolean>` and the
   * SDK documents every value as moving together with the level, so a `'foreignDialects'` capability
   * beside `'projectSettings'` would promise an operator they can grant one and withhold the other,
   * and `resolveTrustPosture` would hand back the same boolean for both. That is precisely the
   * failure ADR 0065 exists to prevent, and inventing the second name would commit it while looking
   * like rigour.
   *
   * The consent half is therefore carried by the declaration, which is a real and sufficient
   * boundary: an operator who trusts a repository completely still reads no `.claude/` until they
   * write this field. What the grant adds on top is stricter than the SDK — there, listing a dialect
   * is enough — and the extra strictness is deliberate: this reads a `hooks.json` that executes
   * shell out of a directory that usually arrived with the clone.
   */
  readonly claudeCode?: ProjectSettingsGrant
}

/**
 * Refusal to read the working directory for lack of trust.
 *
 * Descends from `TheokitAgentError` because typed errors are an unbreakable rule here — and because
 * `isTransientError` only sees this hierarchy. A class extending plain `Error` would be invisible to
 * the predicate that separates recoverable from unrecoverable (the defect M67 fixed in five
 * classes).
 */
export class UntrustedSettingSourceError extends TheokitAgentError {
  override readonly name = 'UntrustedSettingSourceError'

  constructor(
    message: string,
    /** Where the trust decision came from: `'env' | 'store' | 'default'`. */
    readonly trustSource: string,
    /** The refused capability. */
    readonly capability: SettingSourceCapability,
  ) {
    super(message)
  }
}

/**
 * Translate the declared selection into the `SettingSource`s the SDK accepts, refusing what the
 * posture does not authorize.
 *
 * Refuses rather than ignores (ADR 0064). Ignoring would leave the product running in the belief
 * that the repository's hooks are active — a silent failure mode, on the wrong side. The SDK already
 * picked that side for the same problem: `recordWiring` throws `UngatedCapabilityError` when
 * somebody registers a capability the posture does not gate.
 *
 * @throws {UntrustedSettingSourceError} when `project` is requested and the posture does not grant it.
 */
export function resolveSettingSources(
  selection: SettingSourcesSelection | undefined,
): readonly SettingSource[] {
  if (selection === undefined) return []

  const sources: SettingSource[] = []
  if (selection.user === true) sources.push('user')

  const grant = selection.project
  if (grant !== undefined) {
    const posture = grant.trustedBy
    if (!posture.allows.projectSettings) {
      throw new UntrustedSettingSourceError(
        `the \`project\` setting source reads <cwd>/.theokit/ — including shell-executing hooks — ` +
          `and the posture does not grant \`projectSettings\` (level: ${posture.level}, decided ` +
          `by: ${posture.source}). Grant it with a trusted posture, or omit \`project\` to read ` +
          `only the operator's own ~/.theokit/.`,
        posture.source,
        'projectSettings',
      )
    }
    sources.push('project')
  }

  return sources
}

/**
 * The foreign configuration dialects this layer forwards, once the posture authorises them.
 *
 * ## Why it is a separate function and the same vocabulary
 *
 * Separate because the SDK takes them on a separate option (`local.compatSources`); the same
 * `ProjectSettingsGrant` because the thing being authorised is identical — reading a `hooks.json`
 * that executes shell out of a directory the operator does not necessarily control.
 *
 * ## What it deliberately does NOT do
 *
 * Validate the source NAME. The SDK DROPS an unrecognised name rather than turning it into
 * `<cwd>/<name>`, so a typo fails closed there; turning that into a throw here would convert a safe
 * default into a crash. This gate decides authorisation, never vocabulary.
 *
 * @throws {UntrustedSettingSourceError} when a source is requested and the posture does not grant it.
 */
export function resolveCompatSources(
  selection: SettingSourcesSelection | undefined,
): readonly string[] {
  if (selection?.claudeCode === undefined) return []

  const posture = selection.claudeCode.trustedBy
  if (!posture.allows.projectSettings) {
    throw new UntrustedSettingSourceError(
      `the \`claudeCode\` compat source reads <cwd>/.claude/ — including hooks.json, which ` +
        `executes shell — and the posture does not grant \`projectSettings\` (level: ` +
        `${posture.level}, decided by: ${posture.source}). That directory is usually written for a ` +
        `different product and often arrives with the repository, so it needs the same evidence ` +
        `<cwd>/.theokit/ does. Grant it with a trusted posture, or omit \`claudeCode\`.`,
      posture.source,
      'projectSettings',
    )
  }
  // The SDK declares `export type CompatSource = "claude-code"` — kebab, verified against the
  // PUBLISHED package rather than its source, by compiling the literal and its camelCase twin under
  // `--strict` (the `@ts-expect-error` on the twin was consumed, so the union really does reject it).
  //
  // Written out rather than imported, deliberately. `import type { CompatSource } from '@theokit/sdk'`
  // would turn a future disagreement into a compile error, which is strictly better — and it would
  // also stop this package compiling against `^4.52.1`, its own declared floor, where the type does
  // not exist yet. A gate that cannot build against its minimum dependency is worse than a constant
  // that has been checked. Import it when the floor moves past the version that introduced it.
  //
  // The check matters more than a spelling normally would: the SDK DROPS an unrecognised name in
  // silence, so a wrong constant here is a forward that is declared, gated, projected, and then
  // discarded with no message — the exact failure #634 exists to prevent.
  return ['claude-code']
}
