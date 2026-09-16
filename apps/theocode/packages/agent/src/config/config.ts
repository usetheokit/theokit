import { CONFIG_SCHEMA_KEYS, ConfigError, type SchemaKey } from './config-contract.js'
import { auditEnvReachability } from '@theokit/agents'
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
  ENV_SHELL_TIMEOUT_MS,
} from './env-knobs.js'
import { LAYERS, foldLayers, type Layer } from './layers.js'
import {
  firstSettings,
  refuseStrandedToml,
  settingsCandidates,
} from './settings-load.js'
import type { TrustPosture } from './trust-posture.js'
import { applySecurityFloor } from './security-floor.js'

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


interface EnvPath {
  readonly knob: string
  readonly coerce: (raw: string) => unknown
}

/**
 * `1`/`true`/`yes`/`on` and their negatives, case-insensitively; anything else is returned VERBATIM.
 *
 * Returning the raw string on a value it does not recognise is deliberate and matches
 * `numberFromEnv`: the scalar schema then rejects it by name, so `THEOCODE_MEMORY=maybe` fails loud
 * instead of being silently read as `false`. A boolean knob that quietly treats every typo as "off"
 * is the shape where an operator believes a capability is on and it is not.
 */
function booleanFromEnv(raw: string): unknown {
  const v = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'off'].includes(v)) return false
  return raw
}

function numberFromEnv(raw: string): unknown {
  const n = Number(raw)
  return raw.trim().length > 0 && Number.isFinite(n) ? n : raw
}

export const ENV_BY_KEY: Readonly<Partial<Record<SchemaKey, EnvPath>>> = {
  model: { knob: ENV_MODEL, coerce: (s) => s },
  reasoning_effort: { knob: ENV_REASONING_EFFORT, coerce: (s) => s },
  sandbox_mode: { knob: ENV_SANDBOX_MODE, coerce: (s) => s },
  approval_policy: { knob: ENV_APPROVAL_POLICY, coerce: (s) => s },
  goal_oracle: { knob: ENV_GOAL_ORACLE, coerce: (s) => s },
  context_window: { knob: ENV_CONTEXT_WINDOW, coerce: numberFromEnv },
  shell_timeout_ms: { knob: ENV_SHELL_TIMEOUT_MS, coerce: numberFromEnv },
  memory: { knob: ENV_MEMORY, coerce: booleanFromEnv },
  session_gc: { knob: ENV_SESSION_GC, coerce: booleanFromEnv },
  output_style: { knob: ENV_OUTPUT_STYLE, coerce: (s) => s },
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
      .refine(isValidHomeDirName, 'home_dir: expected a single directory name under your home, such as ".theokit" or ".claude" — not a path')
      .optional(),
    shell_timeout_ms: z
      .number()
      .int('shell_timeout_ms: milliseconds are whole numbers')
      .positive('shell_timeout_ms: must be positive — execFile reads 0 as "no timeout"')
      .optional(),
    session_gc: z.boolean().optional(),
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

/**
 * Copy every schema key the layer defined, driven by `CONFIG_SCHEMA_KEYS` rather than by a line per
 * key.
 *
 * The previous shape was ten `if (raw.x !== undefined) out.x = raw.x` statements, and it carried a
 * silent failure mode: add a key to the schema, forget the line, and the key parses, validates, then
 * never reaches the resolved config — settable in `config.toml` and inert at runtime, with nothing
 * raised anywhere. That is the same drift `keysWithoutEnvPath` exists to catch on the environment
 * side, and it deserved a mechanism rather than vigilance.
 *
 * `shell-timeout.test.ts` pins it from the other direction: every key in the schema must survive
 * this copy, and the sample set must cover the whole schema.
 */
function pickScalars(raw: RawScalars): Partial<AgentConfig> {
  const out: Partial<AgentConfig> = {}
  for (const key of CONFIG_SCHEMA_KEYS) {
    const value = raw[key]
    if (value !== undefined) Object.assign(out, { [key]: value })
  }
  return out
}

export interface ConfigLayers {
  user?: unknown
  project?: unknown
  /** `.claude/settings.local.json` — personal and gitignored, above the committed project file. */
  projectLocal?: unknown
  env?: Record<string, string | undefined>
  cli?: unknown
}

const ACCUMULATING_KEYS = ['hooks'] as const

/** Keys whose resolution goes through `applySecurityFloor` instead of plain last-wins. */
const SECURITY_FLOOR_KEYS = ['sandbox_mode', 'approval_policy'] as const

function chosenProfile(layers: readonly z.infer<typeof configSchema>[]): {
  name: string | undefined
  values: RawScalars
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
  if (name === undefined) return { name, values: {} }
  const chosen = profiles[name]
  if (chosen === undefined) {
    throw new ConfigError(`settings.json: unknown profile "${name}" [profile]`)
  }
  return { name, values: chosen }
}

/** The environment layer: only the keys `ENV_BY_KEY` declares a knob for, coerced and validated. */
function envLayer(env: Record<string, string | undefined>): RawScalars {
  const scalars: Record<string, unknown> = {}
  for (const key of CONFIG_SCHEMA_KEYS) {
    const path = ENV_BY_KEY[key]
    if (path === undefined) continue
    const raw = env[path.knob]
    if (raw !== undefined) scalars[key] = path.coerce(raw)
  }
  try {
    return scalarSchema.parse(scalars)
  } catch (err) {
    throw toConfigError(err, 'env')
  }
}

export { CONFIG_SCHEMA_KEYS, ConfigError, type SchemaKey }

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

  const { name: selectedProfile, values: profile } = chosenProfile([
    user,
    project,
    projectLocal,
    cli,
  ])

  const envParsed = envLayer(layers.env ?? {})

  const perLayer: Record<Layer, Partial<AgentConfig>> = {
    defaults: { ...DEFAULTS, skills: [...DEFAULTS.skills], hooks: [...DEFAULTS.hooks] },
    user: pickScalars(user),
    project: pickScalars(project),
    project_local: pickScalars(projectLocal),
    profile: pickScalars(profile),
    env: pickScalars(envParsed),
    cli: pickScalars(cli),
  }
  const folded = foldLayers(
    LAYERS.map((c) => ({
      layer: c.layer,
      values: perLayer[c.layer] as Readonly<Record<string, unknown>>,
    })),
    ACCUMULATING_KEYS,
  )

  // B-006 — `sandbox_mode` and `approval_policy` do not follow plain last-wins. `project` and `env`
  // outrank the user's own file, so a cloned repository (or an inherited environment) could widen
  // the sandbox or switch approvals off and the user's global setting simply lost. Same argument
  // ACCUMULATING_KEYS records for `hooks`, applied to the two keys that decide confinement.
  for (const key of SECURITY_FLOOR_KEYS) {
    const resolved = applySecurityFloor(key, {
      defaults: perLayer.defaults[key] as string | undefined,
      user: perLayer.user[key] as string | undefined,
      project: perLayer.project[key] as string | undefined,
      project_local: perLayer.project_local[key] as string | undefined,
      profile: perLayer.profile[key] as string | undefined,
      env: perLayer.env[key] as string | undefined,
      cli: perLayer.cli[key] as string | undefined,
    })
    if (resolved !== undefined) folded[key] = resolved
  }

  return { ...(folded as unknown as AgentConfig), profile: selectedProfile }
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
  })
}
