import { CONFIG_SCHEMA_KEYS, ConfigError, type SchemaKey } from './config-contract.js'
import { auditEnvReachability } from '@theokit/agents'
import { defineLayeredConfig, envKnob, envLayerFrom, type EnvKnob } from '@theokit/agents/config'
import { homedir } from 'node:os'
import process from 'node:process'
import { join } from 'node:path'

import { DEFAULT_HOME_DIR, LEGACY_HOME_DIR, homeStateDir, isValidHomeDirName } from './home-dir.js'
import { z } from 'zod'

import {
  ENV_APPROVAL_POLICY,
  ENV_CONTEXT_WINDOW,
  ENV_GOAL_ORACLE,
  ENV_OUTPUT_STYLE,
  ENV_MODEL,
  ENV_REASONING_EFFORT,
  ENV_SANDBOX_MODE,
  ENV_MEMORY,
  ENV_SESSION_GC,
  ENV_SESSION_GC_MAX_AGE_DAYS,
  ENV_SHELL_TIMEOUT_MS,
} from './env-knobs.js'
import { firstSettings, refuseStrandedToml, settingsCandidates } from './settings-load.js'
import type { TrustPosture } from './trust-posture.js'
import { SECURITY_FLOORS } from './security-floor.js'
import { readManagedSettingsTranslated, translateManaged } from './managed-settings.js'

/**
 * How long an operator-supplied shell command may run before it is killed.
 *
 * Unchanged from the constant this key replaced, deliberately: the defect was that a hard-coded
 * bound governed an ARBITRARY user command with no way to raise it, not that 10 s was the wrong
 * number. Moving the default at the same time would have changed behaviour for everyone under
 * cover of adding a knob.
 */
export const DEFAULT_SHELL_TIMEOUT_MS = 10_000

const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const
const SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access'] as const
const POLICIES = ['untrusted', 'on-request', 'never'] as const

export type ReasoningEffort = (typeof EFFORTS)[number]
export type SandboxMode = (typeof SANDBOXES)[number]

/** B-076 — exported so a surface offering the choice lists the same values the parser accepts. */
export const SANDBOX_MODES: readonly SandboxMode[] = SANDBOXES
export type ApprovalPolicy = (typeof POLICIES)[number]

export type GoalOracle = 'judge' | 'update_goal'
const GOAL_ORACLES = ['judge', 'update_goal'] as const

export interface AgentConfig {
  model: string
  reasoning_effort: ReasoningEffort
  sandbox_mode: SandboxMode
  approval_policy: ApprovalPolicy
  goal_oracle: GoalOracle
  skills: readonly string[]
  hooks: readonly unknown[]
  /**
   * Durable memory: whether the agent records what it did and recalls it on later turns.
   *
   * OFF by default, which is a deliberate correction rather than a preference. Codex ships the same
   * capability as a feature with `default_enabled: false`
   * (`codex/codex-rs/features/src/lib.rs`, `key: "memories"`, `Stage::Stable`), and this product had
   * it on for every trusted directory with no config key to turn it off — only a volatile session
   * switch that reset on the next launch.
   *
   * Two costs, measured 2026-08-25. It WRITES: a summary of every session lands in
   * `<cwd>/.theokit/memory/sessions/`, so running the agent in a repository leaves files there that
   * nobody asked for (332 KB accumulated in this checkout). And it READS BACK: recall from earlier
   * sessions enters later turns, so two identical runs of the same task can diverge because the
   * second one saw the first — which is exactly the property a benchmark against another agent must
   * not have. It also declares `memory_search` + `memory_get`, 1,462 chars of schema re-sent on
   * every round of every turn.
   *
   * Remembering across sessions is a real feature and worth having; it is not a sensible DEFAULT for
   * a tool that runs inside someone else's repository.
   *
   * ## WHERE it remembers, decided 2026-09-05 (#65)
   *
   * The PROJECT, and this is a decision rather than the default nobody questioned. The SDK gives one
   * memory directory per agent, so the curated `wiki/` corpus belongs either to the repository or to
   * the operator, and there is no arrangement that gives both.
   *
   * It belongs to the repository. A fact about this code — the deploy runbook, the convention that is
   * not in the linter, the reason a workaround exists — is worth exactly as much to whoever clones it
   * next, and under the operator's home it reaches one machine. The mirror argument is real and loses
   * on volume: a preference about how someone likes to work is cheap to restate and expensive to
   * make travel.
   *
   * Measured the same day, with a negative control: a file under `.theokit/memory/wiki/` is recalled
   * by a later session and cited by path and line, and with the file absent the agent reports finding
   * nothing rather than inventing a plausible runbook. Session transcripts are indexed automatically
   * under the same root, so recall already crosses sessions without any tool call.
   *
   * There is no `memory_write`: `BuiltinToolName` is a closed union of `shell`, `memory_search` and
   * `memory_get`. A durable fact is written as an ordinary file under `wiki/`, which is why the
   * choice of root is the whole decision.
   */
  memory: boolean
  /**
   * Milliseconds before an operator-supplied shell command is killed (`/…` custom commands).
   *
   * Its sibling — the hook engine — has taken a per-hook `timeout_ms` since it shipped. This key
   * closes the inconsistency: both features execute commands the operator wrote, so both are the
   * operator's to bound.
   */
  /**
   * The directory under your home where this product keeps its state — transcripts, trust, hook
   * approvals. A NAME, not a path; see `home-dir.ts` for why, and for why an explicit
   * `THEOKIT_HOME` wins over it.
   */
  home_dir: string
  shell_timeout_ms: number
  /**
   * Whether the session collector runs on its own (B-131 / B-132).
   *
   * ON by default, and that is the point of the key rather than an oversight: the retention policy
   * already DECLARED that transcripts older than 30 days are collectable, and nothing applied it, so
   * the declared policy and the behaviour disagreed. Turning it on makes them agree; the key exists
   * so an operator who wants the old behaviour has a decision they can find and record, rather than
   * discovering it from a CHANGELOG.
   *
   * It changes nothing about WHAT is collected: the window, the floor, the budget and the
   * KEEP-what-cannot-be-classified fail-safe are the same ones `sessions gc` has always used.
   */
  session_gc: boolean
  /**
   * #736 — how many days of session transcripts the collector keeps.
   *
   * Optional with NO default here on purpose: absent means the collector keeps its own
   * `DEFAULT_WINDOW_DAYS`, and a second copy of that number in this file would disagree with the
   * first the day one of them moved. `.claude/settings.json` spells it `cleanupPeriodDays`.
   */
  session_gc_max_age_days?: number
  context_window?: number
  /**
   * The output style to apply, by name — Claude Code's feature, read from its directories.
   *
   * Snake_case here and `outputStyle` in a `settings.json`, and BOTH are the same setting: this is
   * the second key (after `model`) whose name and meaning are identical across the two products, so
   * `settings-json.ts` translates theirs onto ours rather than ignoring it. The internal spelling
   * stays snake_case because `env-knobs` derives the variable name from the key, and a camelCase key
   * would have no reachable environment knob at all.
   */
  output_style?: string
  profile?: string
}

export const ENV_BY_KEY: Readonly<Partial<Record<SchemaKey, EnvKnob>>> = {
  model: envKnob(ENV_MODEL, 'string'),
  reasoning_effort: envKnob(ENV_REASONING_EFFORT, 'string'),
  sandbox_mode: envKnob(ENV_SANDBOX_MODE, 'string'),
  approval_policy: envKnob(ENV_APPROVAL_POLICY, 'string'),
  goal_oracle: envKnob(ENV_GOAL_ORACLE, 'string'),
  context_window: envKnob(ENV_CONTEXT_WINDOW, 'number'),
  shell_timeout_ms: envKnob(ENV_SHELL_TIMEOUT_MS, 'number'),
  memory: envKnob(ENV_MEMORY, 'boolean'),
  session_gc: envKnob(ENV_SESSION_GC, 'boolean'),
  session_gc_max_age_days: envKnob(ENV_SESSION_GC_MAX_AGE_DAYS, 'number'),
  output_style: envKnob(ENV_OUTPUT_STYLE, 'string'),
}

interface EnvOptOut {
  readonly key: string
  readonly reason: string
  readonly exitCriterion: string
}

export const ENV_OPT_OUTS: readonly EnvOptOut[] = [
  {
    key: 'home_dir',
    reason:
      'The environment already controls this, through the variable the SDK itself reads: `THEOKIT_HOME`, which takes the resolved PATH and wins over this key. A second variable naming the same fact in a different unit is the two-knobs-that-disagree hazard this key exists to remove.',
    exitCriterion:
      'Never, while `THEOKIT_HOME` exists. If the SDK ever stops reading it, this key needs an environment path of its own and this exemption goes.',
  },
  {
    key: 'skills',
    reason:
      'Array of names: an environment variable is a string, and every obvious coercion (comma, space, JSON) picks a separator a legitimate skill name may contain.',
    exitCriterion:
      'The first consumer that asks for the skill list by environment — then the separator is chosen against a real use case instead of by guesswork.',
  },
  {
    key: 'hooks',
    reason:
      'Array of objects, and the ONLY key that accumulates across layers. An environment variable injecting hooks would be arbitrary code execution declared outside any reviewable file, bypassing the accumulation that stops a project from displacing the user global guard.',
    exitCriterion:
      'Never for convenience. Only if accumulation and reviewability are preserved by another mechanism, decided in its own ADR.',
  },
  {
    key: 'profiles',
    reason:
      'A table of named tables. An environment variable is a string, and any encoding of a nested table into one (JSON, dotted keys) invents a syntax nobody asked for, for a value that is edited once and read forever.',
    exitCriterion:
      'A consumer that needs to define a profile per environment rather than per machine — at which point the encoding is chosen against a real use case instead of by guesswork.',
  },
  {
    key: 'profile',
    reason:
      'Selecting a profile from the environment is reasonable and is NOT implemented. B-041 surfaced this the first time the detector was actually run: the key was neither reachable nor exempt, which is the gap the detector exists to find.',
    exitCriterion:
      'The first request to switch profiles per shell rather than per file. It is a small change — one entry in ENV_KNOBS and one read — and it is deliberately not made on speculation.',
  },
]

/**
 * B-107 — the two detectors are `@theokit/sdk`'s `auditEnvReachability`; the KEYS, the variable names
 * and the reasons stay here, because they are this product's vocabulary. The framework cannot
 * enumerate them and deliberately does not try (same reason the security floor takes its
 * permissiveness order as data), so what it owns is the rule and this ranges over its own keys.
 *
 * The signatures are unchanged: they are called from `env-knobs.test.ts`, which is what turns the
 * two invariants from documentation into a gate.
 */
export function keysWithoutEnvPath(
  keys: readonly string[],
  withEnvPath: ReadonlySet<string>,
  optOut: readonly EnvOptOut[],
): string[] {
  return [
    ...auditEnvReachability({ keys, reachable: [...withEnvPath], optOuts: optOut }).unreachable,
  ]
}

export function optOutsThatExemptNothing(
  keys: readonly string[],
  withEnvPath: ReadonlySet<string>,
  optOut: readonly EnvOptOut[],
): string[] {
  return [
    ...auditEnvReachability({ keys, reachable: [...withEnvPath], optOuts: optOut }).staleOptOuts,
  ]
}

const DEFAULTS: AgentConfig = {
  model: 'openai/gpt-5.6-terra',
  reasoning_effort: 'medium',
  sandbox_mode: 'workspace-write',
  approval_policy: 'on-request',
  goal_oracle: 'judge',
  // Off, matching Codex's `memories` feature. See `AgentConfig.memory` for the measurement.
  memory: false,
  home_dir: DEFAULT_HOME_DIR,
  shell_timeout_ms: DEFAULT_SHELL_TIMEOUT_MS,
  session_gc: true,
  // #67 — empty, because no skill ships with this product. The default was `['daily-briefing']`,
  // a name that resolves to no `SKILL.md` anywhere in the tree or in any state directory, so every
  // fresh install declared a capability it did not have and `/skills` listed it as available. A
  // default that names something absent is worse than none: the panel cannot be read as evidence.
  skills: [],
  hooks: [],
}

export const EFFORT_LEVELS: readonly ReasoningEffort[] = EFFORTS

export function parseEffort(input: string): ReasoningEffort | null {
  const v = input.trim().toLowerCase()
  return (EFFORTS as readonly string[]).includes(v) ? (v as ReasoningEffort) : null
}

export function modelLabel(modelId: string): string {
  const slash = modelId.lastIndexOf('/')
  return slash >= 0 ? modelId.slice(slash + 1) : modelId
}

const scalarSchema = z
  .object({
    model: z.string().min(1, 'model: empty model id — supply `provider/model`').optional(),
    reasoning_effort: z.enum(EFFORTS).optional(),
    sandbox_mode: z.enum(SANDBOXES).optional(),
    approval_policy: z.enum(POLICIES).optional(),
    goal_oracle: z.enum(GOAL_ORACLES).optional(),
    skills: z.array(z.string()).optional(),
    hooks: z.array(z.unknown()).optional(),
    memory: z.boolean().optional(),
    home_dir: z
      .string()
      .refine(
        isValidHomeDirName,
        'home_dir: expected a single directory name under your home, such as ".theokit" or ".claude" — not a path',
      )
      .optional(),
    shell_timeout_ms: z
      .number()
      .int('shell_timeout_ms: milliseconds are whole numbers')
      .positive('shell_timeout_ms: must be positive — execFile reads 0 as "no timeout"')
      .optional(),
    session_gc: z.boolean().optional(),
    session_gc_max_age_days: z.number().int().positive().optional(),
    context_window: z.number().int().positive().optional(),
    output_style: z.string().min(1, 'output_style: empty style name').optional(),
  })
  .strict()

/**
 * Exported for ONE consumer: `migrate-config.ts`, which converts a `config.toml` into a
 * `settings.json` through this exact schema. A conversion that used a hand-written key map could
 * accept what the loader rejects, and the operator would meet that failure one command later, on a
 * file they were told was converted.
 */
export const configSchema = scalarSchema
  .extend({
    profile: z.string().optional(),
    profiles: z.record(z.string(), scalarSchema).optional(),
  })
  .strict()

type RawScalars = z.infer<typeof scalarSchema>

export function toConfigError(err: unknown, where: string): ConfigError {
  if (err instanceof z.ZodError) {
    const issue = err.issues[0]
    const keys =
      issue && 'keys' in issue && Array.isArray((issue as { keys?: unknown[] }).keys)
        ? (issue as { keys: string[] }).keys.join(', ')
        : issue?.path.join('.') || '(root)'
    return new ConfigError(`${where}: ${issue?.message ?? 'invalid config'} [${keys}]`)
  }
  return new ConfigError(`${where}: ${err instanceof Error ? err.message : String(err)}`)
}

export interface ConfigLayers {
  user?: unknown
  project?: unknown
  /** `.claude/settings.local.json` — personal and gitignored, above the committed project file. */
  projectLocal?: unknown
  env?: Record<string, string | undefined>
  cli?: unknown
  /**
   * #737 — the enterprise `managed-settings.json`, deployed by an administrator to a platform
   * path an ordinary user cannot write. Highest precedence, `cli` included.
   */
  managed?: unknown
}

const ACCUMULATING_KEYS = ['hooks'] as const

function chosenProfile(layers: readonly z.infer<typeof configSchema>[]): {
  name: string | undefined
  table: Partial<Record<string, RawScalars>>
} {
  let name: string | undefined
  let profiles: Partial<Record<string, RawScalars>> = {}
  for (const layer of layers) {
    if (layer.profile !== undefined) name = layer.profile
    // B-041 — MERGE per name, not replace. This was an assignment, so a project defining any
    // profile erased every profile the user had defined globally — and the failure is hard: the
    // profile they selected then resolves to nothing and `chosenProfile` throws for a config they
    // did not write. Last-wins is the right rule for a scalar; `profiles` is a table, and last-wins
    // belongs at the level of its entries.
    if (layer.profiles !== undefined) profiles = { ...profiles, ...layer.profiles }
  }
  if (name === undefined) return { name, table: profiles }
  const chosen = profiles[name]
  if (chosen === undefined) {
    throw new ConfigError(`settings.json: unknown profile "${name}" [profile]`)
  }
  return { name, table: profiles }
}

/** The environment layer: only the keys `ENV_BY_KEY` declares a knob for, coerced and validated. */
function envLayer(env: Record<string, string | undefined>): RawScalars {
  const scalars = envLayerFrom(env, ENV_BY_KEY as Readonly<Record<string, EnvKnob>>)
  try {
    return scalarSchema.parse(scalars)
  } catch (err) {
    throw toConfigError(err, 'env')
  }
}

export { CONFIG_SCHEMA_KEYS, ConfigError, type SchemaKey }

const layered = defineLayeredConfig({
  schema: configSchema,
  defaults: DEFAULTS as Partial<z.infer<typeof configSchema>>,
  env: ENV_BY_KEY as Readonly<Record<string, EnvKnob>>,
  accumulate: ACCUMULATING_KEYS,
  floors: SECURITY_FLOORS,
  profiles: { selectKey: 'profile', tableKey: 'profiles' },
})

export function resolveConfig(layers: ConfigLayers = {}): AgentConfig {
  const fromFile = (raw: unknown, where: string): z.infer<typeof configSchema> => {
    if (raw === null || raw === undefined) return {}
    try {
      return configSchema.parse(raw)
    } catch (err) {
      throw toConfigError(err, where)
    }
  }
  const user = fromFile(layers.user, 'settings.json')
  const project = fromFile(layers.project, 'settings.json')
  const projectLocal = fromFile(layers.projectLocal, 'settings.local.json')
  const cli = fromFile(layers.cli, 'cli (-c)')
  // #737 — the enterprise policy. Parsed through the SAME schema as every other layer: a
  // managed file with a typo must fail by name, not be tolerated because of where it came from.
  // #1908 — it is a Claude Code file as often as ours, so it is read as a foreign-root file: Claude Code
  // keys are translated or reported by `settingsReport`, never fatal at startup.
  const managed = fromFile(
    layers.managed === null || layers.managed === undefined
      ? layers.managed
      : translateManaged(layers.managed).values,
    'managed-settings.json',
  )

  // Validated here, with this product's error type and wording; the helper re-validates the same
  // values it is handed, which cannot fail.
  envLayer(layers.env ?? {})

  // The helper merges fields WITHIN a same-named profile and ignores tables in the cli layer; this
  // product replaces the whole profile and lets `-c` define one. So the profile table is settled
  // here and handed over as the user layer's, and the other layers carry no table.
  const { name: selectedProfile, table } = chosenProfile([user, project, projectLocal, cli])
  const noTable = ({ profiles: _p, ...rest }: z.infer<typeof configSchema>) => rest
  const { profile: _managedProfile, ...managedScalars } = noTable(managed)

  const result = layered.resolve({
    user: { ...noTable(user), profiles: table },
    project: noTable(project),
    projectLocal: noTable(projectLocal),
    env: layers.env ?? {},
    cli: noTable(cli),
    managed: managedScalars,
  })
  const { profile: _profile, profiles: _profiles, ...values } = result.values
  return { ...(values as AgentConfig), profile: selectedProfile }
}

/** The three file layers, read from disk, with the trust gate applied to the two project-scoped ones. */
function discoverSettings(opts: {
  projectDir: string
  userDir: string
  env: Record<string, string | undefined>
  projectAllowed: boolean
}): {
  user: unknown | null
  project: unknown | null
  projectLocal: unknown | null
  projectAllowed: boolean
  ourHome: string
} {
  const candidates = settingsCandidates(opts)
  return {
    user: firstSettings(candidates.user),
    project: opts.projectAllowed ? firstSettings(candidates.project) : null,
    projectLocal: opts.projectAllowed ? firstSettings(candidates.projectLocal) : null,
    projectAllowed: opts.projectAllowed,
    ourHome: homeStateDir(opts.env, opts.userDir),
  }
}

function readManagedLayer(): Record<string, unknown> | null {
  const read = readManagedSettingsTranslated({
    onWarn: (m) => process.stderr.write(`warning: ${m}\n`),
  })
  return read === null ? null : read.values
}

export function loadConfig(opts: {
  projectDir?: string
  userDir?: string
  env?: Record<string, string | undefined>
  cli?: unknown
  posture: TrustPosture
}): AgentConfig {
  const projectDir = opts.projectDir ?? process.cwd()
  const userDir = opts.userDir ?? homedir()
  const env = opts.env ?? process.env
  // #124-adjacent, and the reason these paths are spelled out rather than composed elsewhere: a
  // setting written into the wrong directory is ignored with NO error at all. That was measured, not
  // imagined — a valid hook block under the unused root produced `hooks: []` from a trusted
  // directory and read exactly like a product defect. Changing any path here means changing
  // README § "Where configuration lives" in the same commit.
  // #737 — read here rather than in `discoverSettings`, which is about the files a PROJECT and a
  // USER own. This one is neither: an administrator deployed it to a path they cannot write, and no
  // trust posture gates it — the policy binds the untrusted repository too.
  // #1908 — a file that does not parse warns on every start instead of reading as no policy.
  const managedSettings = readManagedLayer()
  const { user, project, projectLocal, projectAllowed, ourHome } = discoverSettings({
    projectDir,
    userDir,
    env,
    projectAllowed: opts.posture.allows.projectConfig,
  })

  refuseStrandedToml(
    'user',
    [join(ourHome, 'config.toml'), join(userDir, LEGACY_HOME_DIR, 'config.toml')],
    user !== null,
  )
  // Only when the project scope is read at all: refusing in an untrusted directory would block every
  // run over a file whose contents this product has already decided to ignore.
  refuseStrandedToml(
    'project',
    projectAllowed
      ? [
          join(projectDir, DEFAULT_HOME_DIR, 'config.toml'),
          join(projectDir, LEGACY_HOME_DIR, 'config.toml'),
        ]
      : [],
    project !== null,
  )

  return resolveConfig({
    ...(user !== null ? { user: user } : {}),
    ...(project !== null ? { project: project } : {}),
    ...(projectLocal !== null ? { projectLocal: projectLocal } : {}),
    env,
    ...(opts.cli !== undefined ? { cli: opts.cli } : {}),
    ...(managedSettings !== null ? { managed: managedSettings } : {}),
  })
}
