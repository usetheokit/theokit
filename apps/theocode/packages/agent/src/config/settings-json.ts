/**
 * `settings.json` — this product's configuration file, wearing Claude Code's filename.
 *
 * TOLERANCE IS DECIDED BY PROVENANCE, NOT BY A LIST. An earlier version of this module carried an
 * explicit 141-key inventory of Claude Code's settings and rejected everything else. It failed on
 * the first real file it met: `~/.claude/settings.json` on this machine, 2026-09-07, carried
 * `remote`, `tui`, `voice`, `voiceEnabled` and `feedbackSurveyState` — five keys the inventory did
 * not know, and eight tests refused to start because of them. A list of somebody else's vocabulary
 * is stale the moment they ship, and the maintenance falls on us at their cadence.
 *
 * So the rule is about WHOSE FILE IT IS. Under `.claude/`, an unknown key is theirs and is ignored
 * and reported. Under this product's own root, an unknown key is a typo and the strict schema
 * rejects it by name — which is what keeps `sandboxMode` from being silently discarded. The
 * inventory survives, doing the smaller job it is actually good for: telling an operator that a key
 * is a Claude Code setting we do not implement, rather than something we could not recognise at all.
 *
 * That filename is the whole difficulty. The file at `.claude/settings.json` is very often a real
 * Claude Code file that somebody else wrote, and both config schemas here are `.strict()`: without
 * a translation step, a valid Claude Code file makes this product refuse to start over
 * `alwaysThinkingEnabled`.
 *
 * So this module does two things and neither is validation — the schema in `config.ts` still owns
 * that:
 *
 *   1. Removes the keys that are theirs and not ours, and RETURNS THEM BY NAME. A key we ignore
 *      must be nameable, or an operator cannot tell an unsupported setting from a misspelt one.
 *      Keys that are in neither group (`sandboxMode`, a camelCase typo of `sandbox_mode`) are left
 *      in place on purpose, so the strict schema rejects them with their own name.
 *   2. Translates `hooks` from their nested-by-event dialect into ours.
 *
 * Every case in the translator came from the shape measured in this repository on 2026-09-07, not
 * from a shape imagined for the occasion. Four of them break a naive forward:
 *
 *   - `timeout` there is SECONDS; `timeout_ms` here is milliseconds. Forwarding the number gives a
 *     30ms budget and kills every hook before its interpreter starts.
 *   - `matcher: "*"` is idiomatic there and is not a regex — `requireCompilableMatcher` throws a
 *     HookError at boot. It means match-all, so it is dropped rather than forwarded.
 *   - Their event vocabulary is larger than ours: this repository's own file carries
 *     `UserPromptSubmit` and `PreCompact`, which we do not have. Those are dropped BY NAME.
 *   - One matcher group holds an array of commands, so a group fans out to N entries.
 *
 * ## What translating a hook here does NOT do — measured 2026-09-07, correcting this file
 *
 * An earlier version of this paragraph claimed that hooks translated here "go through the same
 * fingerprint approval gate as every other hook (`hooks/hook-trust.ts`)". **They do not.** Measured
 * in the TUI with a real TTY, trusted directory, a hook that appends one line per fire:
 *
 * | hooks declared in | fires | `Review hook` prompts | `hook-approvals` written |
 * |---|---|---|---|
 * | neither (negative control) | 0 | 0 | 0 |
 * | `.claude/settings.json` | 3 | 0 | 0 |
 * | `.theokit/settings.json` | 3 | 0 | 0 |
 * | both | 6 | 0 | 0 |
 *
 * Three hooks — arbitrary shell — ran from this product's OWN file without a single prompt. The
 * directory trust gate is what stood between them and the operator, not the fingerprint. Whether
 * that is the intended design for project scope is a separate question; what is not in question is
 * that the comment promised a gate that did not run, and a comment is what the next reader believes.
 *
 * Filed as #130, which asks for the decision in writing rather than assuming either reading.
 *
 * The same run confirms the decision above: the two loaders are simultaneously active and ADDITIVE.
 * The same command in both files fires twice. Translating `.claude/` hooks here would have added a
 * second execution on top of the compatibility loader's, which is why it is not done.
 *
 * Not measured, and therefore not claimed: user scope. A `~/.claude/settings.json` under an isolated
 * HOME produced 0 fires and 0 prompts, which three different explanations fit equally well.
 */
import { TheokitAgentError } from '@theokit/agents'
// Both from `/config`: `PermissionRule` is re-exported there and NOT from the root barrel, which
// the framework's own `names nothing a consumer cannot import` gate measured on 2026-09-12.
import { permissionRulesFromSettings, type PermissionRule } from '@theokit/agents/config'

import { HOOK_EVENTS } from '../hooks/hooks-spec.js'
import { FOREIGN_SETTINGS_KEYS } from './foreign-keys.js'

/** Raised when `settings.json` carries a shape the SDK's own read of the same file would reject. */
class SettingsShapeError extends TheokitAgentError {
  override readonly name = 'SettingsShapeError'
}

interface TranslatedHook {
  readonly event: string
  readonly command: string
  readonly matcher?: string
  readonly timeout_ms?: number
}

export interface ForeignHooksRead {
  readonly hooks: readonly TranslatedHook[]
  /** What was not translated, each with the reason — never silently absent. */
  readonly dropped: readonly string[]
}

export interface TranslateOptions {
  /**
   * The keys this product's own schema defines. Supplied by the caller rather than imported, so this
   * module does not depend on `config.ts` — which depends on it.
   */
  readonly ownKeys: readonly string[]
  /**
   * The directory this settings file lives in, so a path specifier can be anchored to it.
   *
   * `Read(./off-limits.txt)` means that file next to THIS settings file. Without the anchor the
   * rule matches only its relative spellings, and a tool called with an absolute path walks past a
   * deny the operator believes covers it — measured 2026-09-17, end to end.
   */
  readonly baseDir?: string
  /**
   * True for a file under the FOREIGN root (`.claude/`), whose vocabulary belongs to another product
   * and grows on its release cadence, not ours. There, an unknown key is ignored and reported.
   * False for a file under this product's own root, where an unknown key is a typo and the strict
   * schema must reject it by name.
   */
  readonly foreignRoot: boolean
  /**
   * WHO runs the `hooks` in this particular file — measured per path, not assumed per product.
   *
   * `ours`    this product alone. Translated and gated by fingerprint.
   * `refuse`  the SDK reads this file and runs them with no gate of ours. Running them too would
   *           double-fire; not running them leaves shell ungated. Refused (#151).
   * `sdk`     the compatibility loader already runs them. Dropped and reported.
   * `inert`   nothing runs them. Dropped and reported AS SUCH — `loadHookConfig` is cwd-only, so a
   *           user-level `~/.claude/settings.json` hook has no executor at all.
   */
  readonly hooksDelivery: 'ours' | 'refuse' | 'sdk' | 'inert'
}

export interface SettingsRead {
  /** The file in this product's own dialect, ready for `configSchema`. */
  readonly values: Record<string, unknown>
  /** Top-level keys not acted on — Claude Code settings this product does not implement. */
  readonly ignored: readonly string[]
  /**
   * Keys under the foreign root that are in NEITHER vocabulary. Reported apart from `ignored`
   * because the two mean different things to an operator: one is a setting we chose not to
   * implement, the other is very likely a misspelling of something.
   */
  readonly unrecognised: readonly string[]
  readonly droppedHooks: readonly string[]
  /**
   * The `permissions` block, rendered into rules the engine evaluates.
   *
   * Empty when the file declares none, which is most files.
   */
  readonly permissionRules: readonly PermissionRule[]
  /**
   * Permission entries this runtime could not render, each with the reason.
   *
   * Reported rather than thrown, and that asymmetry is the whole reason this goes through
   * `permissionRulesFromSettings` instead of the SDK's raw block. The SDK's `parsePermissionRules`
   * THROWS on a line it cannot read — correct for our own `.theokit/settings.json`, where a bad
   * entry is our bug and should fail loud. `.claude/settings.json` is somebody else's file in
   * somebody else's dialect, and crashing the agent over a line written for another runtime would
   * make their config file able to break ours.
   *
   * Silently dropping it is the opposite failure and the one this product exists to refuse: an
   * operator who wrote a `deny` entry would believe a protection was in place. So: honoured where it
   * can be, named where it cannot.
   */
  readonly unsupportedPermissions: readonly { readonly entry: string; readonly reason: string }[]
}

/**
 * The `permissions` value as a block, or `undefined` when it is not one.
 *
 * Narrowed rather than cast. This is a foreign file: the value can be anything its author typed, and
 * a cast would hand a non-object to the translator and turn a typo in somebody else's config into a
 * crash in ours. A shape we cannot read yields `undefined`, which the translator reads as "no block"
 * — and the key still leaves a trace, because an unreadable block produces no rules and the operator
 * sees no permissions take effect.
 */
function asPermissionsBlock(
  value: unknown,
): { allow?: string[]; deny?: string[]; ask?: string[] } | undefined {
  if (!isRecord(value)) return undefined
  const strings = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((e) => typeof e === 'string') ? [...(v as string[])] : undefined
  const allow = strings(value['allow'])
  const deny = strings(value['deny'])
  const ask = strings(value['ask'])
  return {
    ...(allow === undefined ? {} : { allow }),
    ...(deny === undefined ? {} : { deny }),
    ...(ask === undefined ? {} : { ask }),
  }
}

/** `matcher: "*"` means every tool. It is not a regex, so it is dropped rather than forwarded. */
const MATCH_ALL = '*'

/**
 * Two conventions that are not settings in any dialect, and are present in both files measured
 * here: `$schema`, the editor's JSON Schema pointer, and a leading `_`, the way JSON files carry a
 * comment. Recognising them by shape rather than by name is a heuristic, and its failure mode is
 * bounded in a way the rejected camelCase heuristic's was not: it can only ignore a key an operator
 * deliberately wrote with a leading underscore, and no key of this product's schema has one — which
 * `settings-json.test.ts` asserts rather than assumes.
 */
/**
 * Their key name, ours, for the settings whose NAME and MEANING are both the same.
 *
 * Deliberately tiny, and it will stay tiny. `model` needs no entry — the two products spell it
 * identically. Every other apparent overlap between the two vocabularies is a name collision with a
 * different meaning behind it (`effortLevel` and `reasoning_effort` do not share a value set;
 * `sandbox.enabled` is a boolean where `sandbox_mode` is a three-value enum; `cleanupPeriodDays` is
 * a number of days where `session_gc` is on/off), and translating one of those would silently give
 * an operator a setting they did not ask for.
 *
 * `outputStyle` is the exception that earns the mechanism: same feature, same values, same files on
 * disk. Ours is snake_case only because `env-knobs` derives the variable name from the key.
 */
const SAME_SETTING_DIFFERENT_SPELLING: Readonly<Record<string, string>> = {
  outputStyle: 'output_style',
  // #736 — the same setting under the foreign name. Mapping it rather than adding a second reader is
  // what makes the key HONOURED instead of merely parsed: it lands in `values` like any of ours, and
  // the effective config carries it to the collector.
  cleanupPeriodDays: 'session_gc_max_age_days',
}

function isNonSettingConvention(key: string): boolean {
  return key === '$schema' || key.startsWith('_')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One command entry: the hook, a string naming why it was dropped, or null when it is not one. */
function translateOne(
  event: string,
  matcher: string | undefined,
  entry: unknown,
): TranslatedHook | string | null {
  if (!isRecord(entry)) return null
  const type = entry['type']
  if (type !== 'command' || typeof entry['command'] !== 'string') {
    return `${event}: hook of type "${String(type)}" is not a command`
  }
  // Seconds there, milliseconds here. The unit change is the whole reason this is not a spread.
  const seconds = entry['timeout']
  return {
    event,
    command: entry['command'],
    ...(matcher !== undefined && matcher !== MATCH_ALL ? { matcher } : {}),
    ...(typeof seconds === 'number' ? { timeout_ms: seconds * 1000 } : {}),
  }
}

/** Why this event's block cannot be translated at all, or null when it can. */
function whyNotTranslatable(event: string, groups: unknown): string | null {
  if (!(HOOK_EVENTS as readonly string[]).includes(event)) {
    return `${event}: this product has no such hook event`
  }
  if (!Array.isArray(groups)) return `${event}: expected an array of matcher groups`
  return null
}

/** One event's matcher groups, fanned out: a group holds an array of commands, not one. */
function translateGroups(event: string, groups: readonly unknown[]): (TranslatedHook | string)[] {
  const out: (TranslatedHook | string)[] = []
  for (const group of groups) {
    if (!isRecord(group)) continue
    const matcher = typeof group['matcher'] === 'string' ? group['matcher'] : undefined
    const inner = Array.isArray(group['hooks']) ? group['hooks'] : []
    for (const entry of inner) {
      const one = translateOne(event, matcher, entry)
      if (one !== null) out.push(one)
    }
  }
  return out
}

export function translateForeignHooks(raw: unknown): ForeignHooksRead {
  if (!isRecord(raw)) return { hooks: [], dropped: [] }
  const hooks: TranslatedHook[] = []
  const dropped: string[] = []

  for (const [event, groups] of Object.entries(raw)) {
    const refusal = whyNotTranslatable(event, groups)
    if (refusal !== null) {
      dropped.push(refusal)
      continue
    }
    for (const one of translateGroups(event, groups as unknown[])) {
      if (typeof one === 'string') dropped.push(one)
      else hooks.push(one)
    }
  }
  return { hooks, dropped }
}

/**
 * Bring `hooks` to this product's internal shape, or refuse the file.
 *
 * Its own function because it carries two decisions, and inlining both pushed `translateSettings`
 * past the complexity ceiling — which is the ceiling doing its job: "what shape may hooks take" is
 * one question and deserves to be readable on its own.
 */
function normaliseHooks(
  values: Record<string, unknown>,
  delivery: TranslateOptions['hooksDelivery'],
): readonly string[] {
  const declared = values['hooks']
  if (declared === undefined) return []

  // #151 — the SDK reads this file and runs its `hooks` with no knowledge of our approval store.
  // Measured with a real turn: unapproved shell ran and our refusal never appeared; approved, the
  // hook fired TWICE. Neither outcome is shippable, and there is no third one available from here —
  // so the key is refused until `theokit-sdk#631` lets a consumer declare which surfaces the SDK may
  // import from its root.
  if (delivery === 'refuse') {
    throw new SettingsShapeError(
      'hooks: this file is also read by the SDK, which runs the hooks in it without this ' +
        "product's per-hook approval — and running them here as well would fire each one twice " +
        '(#151). Move them to `.theocode/settings.json`, which only this product reads, where they ' +
        'stay behind the fingerprint gate. A user-level settings.json is unaffected.',
    )
  }

  if (delivery === 'sdk') {
    // Measured 2026-09-12 down the whole chain: `FOREIGN_SURFACES` is
    // `['skills','subagents','plugins','commands']` with no `hooks`, and `@theokit/sdk@5.5.0`'s
    // `adaptersForSurface` admits a narrowed compat source only when `wanted.some((s) => s ===
    // surface)`. So `.claude/` never enters `projectConfigRoots(cwd, …, 'hooks')` and a hook written
    // there is loaded by nobody.
    //
    // This said "run by the compatibility loader … WITHOUT this product's per-hook approval" — the
    // third false statement of this shape in this function, and the same direction as the other two:
    // it reassured. Worse than either truth, because an operator told their shell runs ungated goes
    // looking for a gate to tighten, not for the reason their hook is silent.
    const { dropped } = translateForeignHooks(declared)
    delete values['hooks']
    return [
      ...dropped,
      'hooks in a project .claude/settings.json: nothing runs them. This product withholds the ' +
        '`hooks` surface from the foreign root (it is absent from FOREIGN_SURFACES), so the SDK ' +
        'never lists that root among its hook candidates. Move them to .theocode/settings.json, ' +
        'which this product reads and gates behind the per-hook approval (#130)',
    ]
  }

  if (delivery === 'inert') {
    // `loadHookConfig(cwd, …)` is CWD-ONLY, so a user-level foreign file is in nobody's candidates.
    // Saying "the compatibility loader runs them" here — which this did — is a false statement about
    // arbitrary shell, in the direction that reassures.
    const { dropped } = translateForeignHooks(declared)
    delete values['hooks']
    return [
      ...dropped,
      'hooks in a user-level .claude/settings.json: nothing runs them. The SDK reads hooks from ' +
        'the project directory only, and this product does not read them from a foreign root',
    ]
  }

  if (!isRecord(declared)) {
    throw new SettingsShapeError(
      "hooks: a `settings.json` carries hooks in Claude Code's nested form. Write:\n" +
        '  "hooks": { "Stop": [ { "hooks": [ { "type": "command", "command": "…" } ] } ] }\n' +
        'The event names are unchanged (PreToolUse, PostToolUse, Stop, SessionStart); `timeout` is ' +
        'in seconds there, and `matcher: "*"` means every tool.',
    )
  }
  const read = translateForeignHooks(declared)
  values['hooks'] = read.hooks
  return read.dropped
}

/**
 * Which argument each tool's specifier addresses, for this product's tools.
 *
 * `Bash(rm:*)` addresses the shell's `command`; `Read(./secret)` addresses the reader's `path`. The
 * translator refuses a specifier for a tool absent from this map rather than rendering it against the
 * wrong field, because a matcher on a field the tool does not have never fires — and a rule that
 * looks translated is worse than one reported as untranslatable.
 *
 * Measured 2026-09-17: `Read(./off-limits.txt)` was rendered against `command`, carried by the
 * plugin, and the file was read. The names are this product's registry names, which since the same
 * day are Claude Code's, so a rule pasted from a `.claude/settings.json` addresses the right tool.
 */
const SPECIFIER_ARG: Readonly<Record<string, string>> = {
  Bash: 'command',
  Read: 'path',
  Edit: 'path',
  Glob: 'path',
  ViewImage: 'path',
  ApplyPatch: 'patch',
  Grep: 'pattern',
}


export function translateSettings(raw: unknown, opts: TranslateOptions): SettingsRead {
  if (!isRecord(raw))
    return {
      values: {},
      ignored: [],
      unrecognised: [],
      droppedHooks: [],
      permissionRules: [],
      unsupportedPermissions: [],
    }

  const ours = new Set(opts.ownKeys)
  const values: Record<string, unknown> = {}
  const ignored: string[] = []
  const unrecognised: string[] = []
  let permissionRules: readonly PermissionRule[] = []
  let unsupportedPermissions: readonly { entry: string; reason: string }[] = []
  for (const [rawKey, value] of Object.entries(raw)) {
    const key = SAME_SETTING_DIFFERENT_SPELLING[rawKey] ?? rawKey
    if (key === 'permissions') {
      // #736 — TRANSLATED AND ENFORCED, since the plugin seam landed.
      //
      // This block used to end with `ignored.push(key)`, and a comment explaining that the honest
      // state was to go on reporting the key as not implemented: `@theokit/agents` rendered the
      // rules and nothing built an engine from them, so an operator was told twice that their
      // `deny` did not take effect.
      //
      // That path now exists — `createPermissionsPlugin` builds the engine and the run carries it
      // as a `pre_tool_call` plugin — so the same line became false in the other direction, which
      // is the worse one: the diagnostic told an operator a control was inert while it was
      // refusing their reads. Verified on the built binary before this line moved.
      //
      // `unsupportedPermissions` stays exactly as it was. It is the real information an operator
      // cannot get any other way: WHICH entries could not be rendered, and are therefore not being
      // applied even though the block as a whole is.
      const translated = permissionRulesFromSettings(asPermissionsBlock(value), {
          specifierArg: SPECIFIER_ARG,
          ...(opts.baseDir === undefined ? {} : { baseDir: opts.baseDir }),
        })
      permissionRules = translated.rules
      unsupportedPermissions = translated.unsupported.map((u) => ({
        entry: u.entry,
        reason: u.reason,
      }))
      continue
    }
    if (ours.has(key)) {
      values[key] = value
    } else if (FOREIGN_SETTINGS_KEYS.has(key) || isNonSettingConvention(key)) {
      ignored.push(key)
    } else if (opts.foreignRoot) {
      // Their file, their vocabulary. Tolerated and named — never silently absorbed.
      unrecognised.push(key)
    } else {
      // Our file: leave it in place so the strict schema rejects it, with its own name in the error.
      values[key] = value
    }
  }

  // `hooks` is a name both dialects use for different shapes. Ours is an array; theirs is an object
  // keyed by event. Distinguishing by shape rather than by provenance means a file may legitimately
  // be written either way, which is what "the same filename" has to mean to be worth anything.
  const droppedHooks = normaliseHooks(values, opts.hooksDelivery)

  return { values, ignored, unrecognised, droppedHooks, permissionRules, unsupportedPermissions }
}
