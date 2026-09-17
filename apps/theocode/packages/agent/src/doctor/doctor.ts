/**
 * B-081 — one command that reports what this installation WILL do.
 *
 * The product has a lot to misconfigure — OAuth credentials, layered config, trust posture, the
 * sandbox backend, `.mcp.json` servers that are SPAWNED, disk skills, hooks — and nothing reported
 * on any of it. When something did not take effect, the tools available were reading source and
 * guessing, which is what B-069, B-070 and B-071 each described from inside their own corner.
 *
 * It reports the RESOLVED state, not the files. The gap between what config asks for and what the
 * product does is the whole failure class being diagnosed, so re-printing config would answer the
 * wrong question — the same reasoning that reopened B-071.
 *
 * NO SECRET EVER LEAVES THIS FILE. A credential is reported present / absent / unreadable and never
 * by value, not even truncated: a diagnostic is the output people paste into issues.
 */

/**
 * The quartet — `Check`, `Diagnosis`, `diagnose`, `renderDiagnosis` — moved to
 * `@theokit/agents/doctor` and was deleted here. It is the part every product re-derives
 * identically; the LIST of checks below is the part that is actually this product's.
 *
 * Two things came back richer than what was removed. `Diagnosis.failed` is now a COUNT rather than
 * a boolean, and `diagnose([])` no longer reports a clean bill of health: an empty list exits
 * non-zero, because a product whose check list failed to load would otherwise announce that an
 * installation nobody examined is fine. The local version had exactly that hole.
 */
import type { SettingsFileReport } from '../config/settings-load.js'
import { refusalNotice } from '../hooks/foreign-hook-gate.js'
import type { Check } from '@theokit/agents/doctor'

/**
 * What is known about the stored credential. Presence only — never the value, not even truncated,
 * because this output is pasted into issues.
 *
 * `expired` is a distinct state, not a flavour of `present`. An OAuth credential that parsed but
 * whose `expires` had passed made this report `✓ credential: present` — measured 2026-08-25 against
 * a token ten days past expiry. A diagnostic whose job is to answer "is this ready to run?" said
 * yes about the one thing that was going to fail first.
 *
 * The docstring on `collectChecks` has claimed since it was written that the tests can "drive an
 * expired credential". They could not: the state did not exist.
 */
export type CredentialState = 'present' | 'absent' | 'unreadable' | 'expired'

export { diagnose, renderDiagnosis } from '@theokit/agents/doctor'

/** The credential row, one branch per state — no state collapses into another. */
function credentialCheck(state: CredentialState): Check {
  switch (state) {
    case 'present':
      return { name: 'credential', status: 'ok', detail: 'present' }
    case 'expired':
      return {
        name: 'credential',
        status: 'warn',
        detail:
          'EXPIRED — the stored token is past its expiry. A refresh may still renew it on the ' +
          'next turn; if it does not, run `theocode` and use /login.',
      }
    case 'absent':
      return {
        name: 'credential',
        status: 'fail',
        detail: 'absent — run `theocode` and use /login, or set the provider key',
      }
    case 'unreadable':
      return {
        name: 'credential',
        status: 'fail',
        detail: 'unreadable — the credential file exists and could not be parsed',
      }
  }
}

/**
 * One capability row: what is active, or why nothing is.
 *
 * At module scope rather than inside `collectChecks` — it closes over nothing, and the linter's
 * function-length ceiling is a real signal here: the row now carries three states.
 */
const entity = (
name: string,
e: { active: readonly string[]; suppressedByTrust: boolean },
): Check =>
  e.suppressedByTrust
    ? {
        name,
        status: 'warn',
        // A warning, not a failure: trust-gating is the product working as designed. It is
        // reported because a user debugging "my hook does not run" needs to see it, not because
        // anything is broken.
        //
        // #72 — suppressed AND non-empty is a real state for `mcp` alone: the operator's own
        // servers are not gated on project trust. Reporting only the suppression would say "not
        // wired" about a server that is running; reporting only the list would hide that the
        // repository's share was withheld. Whoever is debugging either half needs the other.
        detail:
          e.active.length === 0
            ? 'declared but NOT wired — this directory is untrusted'
            : `${e.active.join(', ')} — yours; the project's are NOT wired, this directory is untrusted`,
      }
    : {
        name,
        status: 'ok',
        detail: e.active.length === 0 ? 'none' : e.active.join(', '),
      }

/**
 * The checks for a directory: resolved config, trust, sandbox, credential presence, and what an
 * agent built here would actually wire.
 *
 * Every dependency is INJECTED. That is not ceremony — it is what lets the tests drive an expired
 * credential, an untrusted directory and a broken config without arranging any of them on disk,
 * and it keeps this function from being a second resolution path of its own.
 */
/** The disagreement between the declared skills and the disk, or no row when there is none. */
type SkillsOnDiskFindings = {
  readonly declaredButAbsent: readonly string[]
  readonly presentButUndeclared: readonly string[]
  readonly declaredUserOnlySoNotLoaded?: readonly string[]
  readonly foreignRootSkills?: readonly string[]
}

/**
 * One line per finding, in the order an operator can act on them.
 *
 * Split out of `skillsOnDiskCheck` when the foreign-root line pushed that function to complexity
 * 11 against a max of 10 — the same gate that caught the subagent loader, and the same answer:
 * extract rather than suppress.
 */
function skillsOnDiskParts(found: SkillsOnDiskFindings): string[] {
  const parts: string[] = []
  if (found.declaredButAbsent.length > 0)
    parts.push(`declared with no SKILL.md: ${found.declaredButAbsent.join(', ')}`)
  if (found.presentButUndeclared.length > 0)
    parts.push(`on disk but declared nowhere, so not loaded: ${found.presentButUndeclared.join(', ')}`)
  // #65 — a third state, and its remedy is neither of the two above: the file exists and the config
  // names it, and it still does not load, because the resolver builds every root from `cwd`. Saying
  // "no SKILL.md" here named a cause that is false; saying nothing left a declared skill silently
  // inert. Naming the root is what makes the row actionable — the fix is to move the file.
  const userOnly = found.declaredUserOnlySoNotLoaded ?? []
  if (userOnly.length > 0)
    parts.push(
      `on disk only under your own root, which is not read — move into the project to load: ${userOnly.join(', ')}`,
    )
  // The foreign root is REPORTED, with no remedy attached — see `foreignRootSkills`. Without this
  // line the whole row disappeared whenever the native root was clean, so a project whose skills
  // all live under `.claude/skills/` got `skills: none` and nothing else. Measured 2026-09-15: 76
  // on disk there, the model carrying 40 of them, and both surfaces answering "none".
  const foreign = found.foreignRootSkills ?? []
  if (foreign.length > 0)
    parts.push(
      `${String(foreign.length)} under .claude/skills/, loaded by the compatibility dialect ` +
        `without a config line (this row cannot say which reached the model)`,
    )
  return parts
}

/**
 * A surface under the foreign root, with how many files it holds and whether this product acts on
 * them. Supplied by the caller rather than read here, like `skillsOnDisk` and `foreignHooks`: this
 * module turns findings into rows and does not go to disk.
 */
export interface ForeignSurface {
  /** The directory under `.claude/`, e.g. `agents`. */
  readonly dir: string
  /** How many files it holds. A count, because presence and a loaded tree must not read alike. */
  readonly files: number
  /**
   * What this product does with them.
   *
   * `refused` is a DECISION, with a reason about this product — `workflows` is the case.
   * `unread` is not a decision: the surface is present and nothing here consumes it yet. Keeping
   * them apart matters because collapsing them reports a gap as a policy, and an author reading
   * `refused` stops looking for the capability while an author reading `unread` knows it is coming.
   */
  readonly state: 'read' | 'refused' | 'unread'
}

/**
 * The foreign-root surfaces this product loads, or no row when the caller found none.
 *
 * MEASURED 2026-09-15 in a consumer: `.claude/agents/` held 139 files, `commands/` 5,
 * `agent-memory/` 1 and `workflows/` 1, and the whole report named none of them. Fourteen checks
 * ran and not one was about the 139 agent definitions being loaded.
 *
 * The positive control that made it a gap rather than a guess about intent: `skillsOnDiskCheck`
 * above already reports the foreign root. The report can speak about these surfaces and did not.
 *
 * ## One row, and the state travelling with each count
 *
 * The operator's question is one question — what under `.claude/` does this product act on — so
 * four rows would answer it four times and leave the reader to add up. But `workflows` is REFUSED
 * where the others are READ, and a row printing four bare counts would present a refusal as a
 * capability. That is the accepted-and-ignored failure the surfaces rule exists to prevent,
 * arriving through the diagnostic instead of through the loader.
 */
function foreignSurfacesCheck(found: readonly ForeignSurface[] | undefined): Check[] {
  if (found === undefined || found.length === 0) return []
  const parts = found.map((s) => `${s.dir}: ${String(s.files)} ${s.state}`)
  return [
    {
      name: 'foreign-surfaces',
      // A warning, never a failure — the reasoning `skillsOnDiskCheck` and `foreignHookCheck`
      // follow. A surface being present breaks nothing, and exiting non-zero over it would report
      // a working install as broken.
      status: 'warn',
      detail: `under .claude/ — ${parts.join(' · ')}`,
    },
  ]
}

/** The disagreement between the declared skills and the disk, or no row when there is none. */
function skillsOnDiskCheck(found: SkillsOnDiskFindings | undefined): Check[] {
  if (found === undefined) return []
  const parts = skillsOnDiskParts(found)
  if (parts.length === 0) return []
  // A warning, never a failure: neither direction breaks a working install, and exiting non-zero
  // over a skill someone is midway through writing would report work-in-progress as broken.
  return [{ name: 'skills-on-disk', status: 'warn', detail: parts.join(' · ') }]
}

/**
 * The credential left in a directory this product does not read (#72), or no row when there is none.
 *
 * Extracted from `collectChecks` rather than suppressed when the length gate fired on it: every
 * other row in this module is already a named function, so the inline form was the outlier, and
 * lifting it makes the file more consistent instead of less.
 */
function strayCredentialCheck(strays: readonly string[] | undefined): Check[] {
  const found = strays ?? []
  if (found.length === 0) return []
  return [
    {
      name: 'credential-strays',
      // A warning, never a failure: nothing is broken. It is a leftover to remove, and exiting
      // non-zero over one would report a working install as broken.
      status: 'warn',
      detail: `not read by this product — remove if you no longer need it: ${found.join(', ')}`,
    },
  ]
}

/**
 * The hook files the framework loads directly, which this product refuses to let it spawn.
 *
 * Lands beside `settingsCheck` because it is the same question with a different file: a hook in a
 * project `.claude/settings.json` already reaches the operator through `droppedHooks`, and
 * `.theokit/hooks.json` reached them through nothing. Inventing a second surface for one question
 * is how two answers start to disagree.
 *
 * Appended only when there is something to say — the rule the rows around it follow.
 */
function foreignHookCheck(
  refusals: readonly { path: string; commands: readonly string[] }[] = [],
): Check[] {
  if (refusals.length === 0) return []
  return [
    {
      name: 'hooks-not-run',
      // A warning, never a failure. The operation a refused hook attached to still proceeds by
      // design, so nothing is broken; exiting non-zero would report a working install as broken.
      status: 'warn' as const,
      detail: refusals.map((r) => refusalNotice(r)).join(' | '),
    },
  ]
}

/**
 * What this file's permission rules actually do, which depends on whether the key is implemented.
 *
 * #824 — the previous line listed ONLY the entries whose syntax would not translate. A reader
 * concluded, reasonably, that the rules absent from that list DID apply. None applied: `permissions`
 * sits in `ignored`, so no rule in the file reaches an engine, translatable or not.
 *
 * Measured 2026-09-17 beside Claude Code, which refused the same `deny` rule this product honoured
 * with the file's canary. The comment on the old line argued that `ignored` and this line together
 * gave the operator both halves. They do not compose: one names KEYS and the other names ENTRIES, so
 * the second reads as the specific list and the first as background.
 *
 * Both branches are kept, and the second is not hypothetical — it is what this row must say the day
 * enforcement lands, which makes that transition visible instead of silent.
 */
function permissionNotice(r: SettingsFileReport): string {
  const untranslatable =
    r.unsupportedPermissions.length > 0
      ? ` These would not have translated either: ${r.unsupportedPermissions.join('; ')}`
      : ''
  if (r.ignored.includes('permissions')) {
    return (
      'no permission rule from this file is in force — `permissions` is not implemented here, so ' +
      `every allow and deny in it is inert, not only the ones below.${untranslatable}`
    )
  }
  return r.unsupportedPermissions.length > 0
    ? `permission entries not honoured: ${r.unsupportedPermissions.join('; ')}`
    : ''
}

function settingsCheck(reports: readonly SettingsFileReport[] = []): Check[] {
  const said = reports
    .map((r) => {
      const parts = [
        r.ignored.length > 0 ? `not implemented here: ${r.ignored.join(', ')}` : '',
        r.unrecognised.length > 0 ? `unrecognised: ${r.unrecognised.join(', ')}` : '',
        r.droppedHooks.length > 0 ? `hooks not translated: ${r.droppedHooks.join('; ')}` : '',
        // Named apart from `ignored` on purpose, and the two say different things about the same
        // block. `permissions` stays in `ignored` because ENFORCEMENT is still missing — the
        // translated rules reach no engine, since `AgentBuilder` has no seam to take them. This
        // second line is about TRANSLATION: an entry listed here did not even render, so its
        // problem is that LINE rather than the absent seam. An operator needs both, and neither
        // alone would let them believe a `deny` they wrote is in force.
          permissionNotice(r),
      ].filter((p) => p !== '')
      return parts.length > 0 ? `${r.path} — ${parts.join('; ')}` : ''
    })
    .filter((line) => line !== '')
  // Appended only when there is something to say: a row that permanently reads "none" is noise, and
  // noise is what makes a diagnostic stop being read.
  if (said.length === 0) return []
  return [
    {
      name: 'settings',
      // A warning, never a failure. Nothing is broken by a key this product chose not to implement.
      status: 'warn' as const,
      detail: said.join(' | '),
    },
  ]
}

function outputStyleCheck(style?: { name: string; resolved: boolean }): Check[] {
  if (style === undefined) return []
  return [
    {
      name: 'output-style',
      status: style.resolved ? ('ok' as const) : ('warn' as const),
      detail: style.resolved
        ? style.name
        : `${style.name} — no such file under .claude/output-styles/; the built-in instructions are in use`,
    },
  ]
}

export function collectChecks(input: {
  readonly cwd: string
  /**
   * The build this install is. Optional so a caller that did not look says nothing — but the CLI
   * always passes it: #128 recorded that a bug reporter had no in-product way to name their build.
   */
  readonly version?: string
  readonly trustLevel: string
  readonly model: string
  readonly effort: string
  readonly sandboxMode: string
  readonly approvalPolicy: string
  readonly credential: CredentialState
  /**
   * Credential files in a state directory this product does not read (#72). Optional: a caller that
   * does not look for them says nothing, rather than asserting there are none.
   */
  readonly strayCredentials?: readonly string[]
  /**
   * What configuration claims about skills, held against the disk (#67). Optional: a caller that did
   * not look says nothing, rather than asserting the two agree.
   */
  readonly skillsOnDisk?: {
    readonly declaredButAbsent: readonly string[]
    readonly presentButUndeclared: readonly string[]
    readonly declaredUserOnlySoNotLoaded?: readonly string[]
  }
  /**
   * Per `settings.json` actually read: what it carried that this product did not act on. Optional,
   * so a caller that did not look says nothing rather than asserting the files were clean.
   */
  readonly settingsIgnored?: readonly SettingsFileReport[]
  /**
   * Surfaces under the foreign root and what this product does with them. Optional: a caller that
   * did not look says nothing, rather than asserting there are none.
   */
  readonly foreignSurfaces?: readonly ForeignSurface[]
  /**
   * Hook files the framework loads directly, which this product refuses to let it spawn (#130).
   *
   * Supplied by the caller rather than read here, like `skillsOnDisk` beside it: this module turns
   * facts into rows and does no I/O, so a test can state a situation instead of building one on
   * disk. Optional, so a caller that did not look says nothing rather than asserting there are none.
   */
  readonly foreignHooks?: readonly { path: string; commands: readonly string[] }[]
  /**
   * The configured output style and whether a file was found for it. Optional: a caller that did not
   * look says nothing, rather than asserting no style is configured.
   */
  readonly outputStyle?: { readonly name: string; readonly resolved: boolean }
  readonly wired: {
    readonly mcp: { active: readonly string[]; suppressedByTrust: boolean }
    readonly skills: { active: readonly string[]; suppressedByTrust: boolean }
    readonly hooks: { active: readonly string[]; suppressedByTrust: boolean }
  }
}): Check[] {
  return [
    // First, because it is the first thing a support session asks for.
    ...(input.version === undefined
      ? []
      : [{ name: 'version', status: 'ok' as const, detail: input.version }]),
    { name: 'cwd', status: 'ok', detail: input.cwd },
    {
      name: 'trust',
      status: input.trustLevel === 'trusted' ? 'ok' : 'warn',
      detail:
        input.trustLevel === 'trusted'
          ? 'trusted'
          : `${input.trustLevel} — project config, AGENTS.md, hooks, skills, MCP and memory are all withheld`,
    },
    credentialCheck(input.credential),
    { name: 'model', status: 'ok', detail: `${input.model} (${input.effort})` },
    { name: 'sandbox', status: 'ok', detail: input.sandboxMode },
    { name: 'approval', status: 'ok', detail: input.approvalPolicy },
    entity('mcp', input.wired.mcp),
    entity('skills', input.wired.skills),
    entity('hooks', input.wired.hooks),
    // #67 — the skills row above reports what was DECLARED. This one reports where that disagrees
    // with the disk, in both directions, because they have different remedies: a name to delete or a
    // file to write, against a config line to add. A green tick for a skill that is not there is the
    // shape this repository has fixed three times.
    ...skillsOnDiskCheck(input.skillsOnDisk),
    // `settings.json` is Claude Code's filename, so a real one carries their settings. Tolerating
    // them is what lets the product start; naming them is what stops the tolerance from teaching an
    // operator that a key is read when it is not.
    ...settingsCheck(input.settingsIgnored),
    ...foreignSurfacesCheck(input.foreignSurfaces),
    // #130 — the hooks the framework would spawn without this product's approval, and therefore does
    // not spawn at all. Answered from disk at diagnosis rather than at the spawn: the spawn-time
    // notice can only arrive after the hook has already failed to fire, and "will my hook run?" is
    // answerable before the turn starts.
    ...foreignHookCheck(input.foreignHooks),
    // The style is applied silently — a name that matches no file falls back to the built-in
    // instructions so a typo cannot take the turn away. That fallback has to be loud somewhere.
    ...outputStyleCheck(input.outputStyle),
    // Appended only when there is something to say. A row that permanently reads "none" is noise in
    // a nine-row diagnostic, and noise is what makes a diagnostic stop being read.
    ...strayCredentialCheck(input.strayCredentials),
  ]
}
