import { projectSettingsPosture, projectSourceAllowed } from './config/project-source.js'
import type { TrustPosture } from './config/index.js'

type Grant = { trustedBy: ReturnType<typeof projectSettingsPosture> }
/** The foreign root carries one field the native one must not: which surfaces to import (#130). */
type ForeignGrant = Grant & { import: typeof FOREIGN_SURFACES }

/**
 * Which configuration roots the framework may read.
 *
 * Lifted out of `chat.ts` when it stopped being a ternary: it is a TRUST GATE, and a gate that has
 * grown a second door belongs where a reader looking for gates will find it.
 *
 * `user: true` survives an untrusted directory, and that asymmetry is deliberate — the gate asks
 * whether THIS repository's code is trusted, and the operator's home is not the repository.
 * `user-agents-md.ts` sets out the reasoning at length.
 *
 * `claudeCode` reads `<cwd>/.claude/` (#65, usetheokit/theokit#634). It takes the SAME grant
 * `project` takes, and that is the security decision worth stating plainly: `.claude/` is
 * repository-controlled — it usually arrived with the clone — and holds a `hooks.json` that executes
 * shell. A second door with another product's name on it must not be easier to open than the first.
 *
 * Declaring the field and trusting the directory answer two different questions, which is why the
 * framework keeps them in one value: the field says "import another product's configuration", the
 * `TrustPosture` inside says "run code from this directory". This product answers the first yes
 * unconditionally — an adopter's `.claude/` is the reason they are here — and leaves the second to
 * the gate that already existed.
 *
 * Verified end to end on the built binary, one project holding both, trusted directory:
 *
 *     .theokit/agents/native.md   -> delegated, NATIVE-OK
 *     .claude/agents/foreign.md   -> delegated, FOREIGN-OK
 *     .claude/skills/x/SKILL.md   -> body reached the prompt
 *
 * and `local` arriving at the SDK as
 * `{"settingSources":["user","project"],"compatSources":["claude-code"]}`.
 *
 */

/**
 * #130 — which surfaces of `.claude/` this product imports, and the one it does not.
 *
 * `hooks` is absent, and that absence is the whole declaration. A `.claude/` directory usually
 * arrives with the clone, written for another product by someone who never heard of this one, and
 * its `hooks` key is arbitrary shell on every tool call. Until `@theokit/agents@13.0.0-next.9` the
 * grant was per SOURCE, so wanting the skills meant taking the hooks: measured, such a hook fired
 * once with no approval prompt and no approval file written.
 *
 * This is the second of two answers to that, and they are not redundant. `hookApproval` refuses at
 * the SPAWN point and covers every root, including `.theokit/hooks.json`, which is not a compat
 * source at all. This one keeps the framework from reading those hooks in the first place. The gate
 * is what closes the hole; this is what narrows what has to reach a gate.
 *
 * `plugins` STAYS, and not by oversight. A `.claude/plugins/<bundle>/skills/<name>/SKILL.md` answers
 * on the built binary — measured 2026-09-06 — and nothing here establishes whether those skills
 * arrive through the `skills` surface or the `plugins` one. Dropping a surface whose consequence is
 * unmeasured would trade a defect for a silent regression in somebody's skill inventory. It is a
 * code-loading surface and worth removing; it is worth removing after a measurement, not before.
 *
 * An empty list is refused by the framework rather than interpreted, which is right: it reads as
 * "no surfaces" or as "not declared, therefore all", and the two differ by whether shell runs.
 *
 * ## What this list does NOT govern, measured
 *
 * It governs what the FRAMEWORK loads through the builder. Two of this product's foreign surfaces
 * never pass through it, because each reaches `.claude/` with a direct call carrying its own
 * `compatSources: ['claude-code']`:
 *
 * | surface | reached by | governed here |
 * |---|---|---|
 * | skills | the builder | yes |
 * | subagents | `delegation/role-discovery.ts` | **no** |
 * | commands | `tui/commands/custom-commands.ts` | **no** |
 * | a delegated role's own root | `delegation/roles.ts` | **no** |
 *
 * The fourth was nearly a hole and is not: that call builds a CHILD agent's `local` with no hook
 * approval gate of its own, so a subagent could in principle have spawned what the parent refuses.
 * Measured with delegation confirmed rather than assumed — the child ran its tool and reported the
 * file's contents — and the foreign hook fired zero times.
 *
 * Measured: removing `'subagents'` from this list leaves `discoverRoles` returning the foreign role
 * exactly as before. The entry is kept anyway — it states what the framework may load from that
 * root, which is true and would matter the moment anything routes through it, and the asymmetry
 * favours it: keeping it costs a comment, dropping it silently loses foreign roles the day the
 * framework starts honouring it.
 *
 * What must NOT be assumed is the converse. **Tightening this list does not tighten those two
 * surfaces**, and a reader who removed `'subagents'` believing it stopped foreign roles would be
 * wrong. Converging the three call sites on one declaration is tracked separately; until then this
 * comment is the only thing that says so, and `setting-sources.test.ts` pins the divergence so it is
 * discovered rather than believed.
 */
export const FOREIGN_SURFACES = [
  'skills',
  'subagents',
  'plugins',
  'commands',
  // B-011 — the foreign root's INSTRUCTIONS (`.claude/rules/*.md`). Added because the SDK gained a
  // gate for them: `FileContextManager` used to consult no foreign-dialect grant at all, so this
  // repository's rules reached the system prompt through a door the other four surfaces were
  // correctly refused at. Once that gate ships, a narrowed `import` list without this name loses
  // them — silently, which is the failure the gate exists to prevent, arriving from the other side.
  //
  // Not a widening: this product already received those rules on every run. The name is what keeps
  // that true once the grant is enforced.
  'context',
] as const

/**
 * The same list, minus what the SDK's vocabulary does not have.
 *
 * `@theokit/agents@13.0.0-next.10` added `'commands'` to its `CompatSurface`; the published
 * `@theokit/sdk@5.5.0` still has four names, because custom commands are loaded by the layer and
 * never by the SDK. So a call that builds SDK `local` options directly — `delegation/roles.ts`, for
 * a delegated child — cannot carry that name, and the compiler says so rather than the value being
 * dropped at runtime.
 *
 * `'context'` was excluded here TEMPORARILY while usetheokit/theokit-sdk#652 was merged and
 * unpublished, and that clause is gone: `@theokit/sdk@5.6.0` declares
 * `"context" | "hooks" | "plugins" | "skills" | "subagents"`, measured against the resolved copy.
 * The name crosses now. Leaving the exclusion would have kept withholding the rules from a runtime
 * that had just learned to honour them — the same silence the grant exists to remove, produced from
 * this side instead.
 *
 * DERIVED, never written out a second time. A hand-copied list beside the full one is the divergence
 * this whole constant exists to remove, and it would go stale the moment a surface is added. What
 * this expresses is one decision projected onto a narrower vocabulary, not two decisions.
 */
export const SDK_FOREIGN_SURFACES = FOREIGN_SURFACES.filter(
  (surface): surface is Exclude<(typeof FOREIGN_SURFACES)[number], 'commands'> =>
    surface !== 'commands',
)

export function settingSourcesFor(posture: TrustPosture): {
  user: true
  project?: Grant
  claudeCode?: ForeignGrant
} {
  if (!projectSourceAllowed(posture.allows)) return { user: true }
  // One grant object for both, so they cannot drift apart into a weaker gate for the foreign root.
  const grant: Grant = { trustedBy: projectSettingsPosture(posture) }
  return { user: true, project: grant, claudeCode: { ...grant, import: FOREIGN_SURFACES } }
}
