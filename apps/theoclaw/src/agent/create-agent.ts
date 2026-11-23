import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { Agent, SkillReadTool } from '@theokit/sdk'
import type { CustomTool, HookApprovalGate, MemorySettings, InlineSkill, McpServerConfig, ModelSelection, Plugin, SDKAgent } from '@theokit/sdk'
import type { Skill } from '@theokit/sdk/skills'

import { custodianSkills } from '../skills/custodian.js'
import { discoverWinners, legacyRequiresSkills } from '../skills/legacy-compat.js'
import { binaryOnPath, bundledSkills } from '../skills/registry.js'
import type { ImportedSetup } from '../migration/import-store.js'
import type { AgentTelemetry } from '../telemetry/otel.js'
import type { AgentToolOptions } from '../tools/tool-registry.js'
import { createHookApprovalGate } from './hook-approval.js'
import { UNTRUSTED_CONTENT_NOTICE, untrustedContentSendOptions, type UntrustedContentSendOptions } from './untrusted-content.js'

/**
 * The SDK's local options TheoClaw sets. `hooks` is on every agent (B-397 FR-007): the SDK reads a
 * hook gate only here, and throws on a top-level `hooks`. `settingSources` has `project` once a
 * hook fingerprint is approved; the gate still vets every hook command. Whoever adds `cwd` or
 * `sessionDir` merges them into this object, so the gate is never dropped.
 */
export interface TheoClawLocalOptions {
  readonly hooks: HookApprovalGate
  readonly cwd?: string
  readonly sessionDir?: string
  /**
   * `'plugins'` for an agent given a plugin workspace (OC-75), `'project'` when the owner approved
   * at least one hook fingerprint (OC-87); absent loads neither.
   */
  readonly settingSources?: Array<'plugins' | 'project'>
}

/** The `SkillsSettings` fields TheoClaw sets. */
export interface TheoClawSkills {
  readonly bundledDirs: string[]
  /** The first directory again: with the `project` source on the SDK reads `skillsDir` instead of its own project and plugin skill roots. */
  readonly skillsDir?: string
  readonly inline: InlineSkill[]
}

/** The thinking levels `THEOCLAW_THINKING` accepts (OC-48). */
export const THINKING_LEVELS = ['off', 'low', 'medium', 'high'] as const
export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

/** The level `THEOCLAW_THINKING` names; unset or blank is `undefined`, anything else is refused. */
export function parseThinkingLevel(value: string | undefined): ThinkingLevel | undefined {
  const trimmed = value?.trim().toLowerCase()
  if (trimmed === undefined || trimmed === '') return undefined
  if ((THINKING_LEVELS as readonly string[]).includes(trimmed)) return trimmed as ThinkingLevel
  throw new Error(`THEOCLAW_THINKING must be one of ${THINKING_LEVELS.join(', ')}`)
}

/** The secondary model `THEOCLAW_MODEL_FALLBACK` names (OC-47), or `undefined` when none is set. */
export function parseFallbackModel(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/** The options every TheoClaw agent is created with, every one of them. */
export interface TheoClawAgentOptions<Model extends string | ModelSelection = string> {
  /** The `THEOCLAW_MODEL` string in the process; a `{ id, url }` selection in the stub tests. */
  readonly model: Model
  readonly apiKey: string
  /** The SDK registers an unsandboxed `shell` on every local agent; no TheoClaw agent gets it. */
  readonly withheldBuiltinTools: readonly 'shell'[]
  /** Off unless the caller passes SDK memory settings with a `directory`: a default would write transcripts under `.theokit/memory/` in the cwd. */
  readonly memory: MemorySettings
  readonly local: TheoClawLocalOptions
  readonly tools?: CustomTool[]
  readonly plugins?: Plugin[]
  /**
   * Opens with `UNTRUSTED_CONTENT_NOTICE` on every agent (B-398 FR-002); a `/control` agent with an
   * import has the import's instructions and read-only memory after it (FR-008).
   */
  readonly systemPrompt: string
  /** The SDK reads these per send; set once here, so no send site passes them (OC-88). */
  readonly sendDefaults: UntrustedContentSendOptions
  /** Models the SDK reruns a turn on when the primary fails before any output (`THEOCLAW_MODEL_FALLBACK`, OC-47). */
  readonly modelFallback?: { readonly models: string[] }
  /**
   * The SDK's `SkillsSettings`: `bundledDirs` (workspace, then user; the SDK takes the
   * first skill of a name) and `inline` (custodian, import, legacy `requires:` skills).
   */
  readonly skills?: TheoClawSkills
  /**
   * Rebuilds `skills`. The SDK evaluates it on every `send()` (a `skills` resolver, see
   * `withSdkSkills`), so a skill installed into the workspace after a session opened is offered on
   * that session's next turn, and `skill_read` reads the same fresh list (OC-72).
   */
  readonly skillsRefresh?: () => Promise<TheoClawSkills>
  /**
   * Only on a `/control` agent: its browser server with `THEOCLAW_BROWSER=on`, the servers its
   * external tools file names, and an import's servers with `THEOCLAW_IMPORTED_MCP` on; never on
   * a chat agent.
   */
  readonly mcpServers?: Record<string, McpServerConfig>
  /** SDK telemetry, present only with `THEOCLAW_OTEL=on` (B-400 FR-006); never prompt content. */
  readonly telemetry?: AgentTelemetry
  /** `THEOCLAW_THINKING` (OC-48), handed to the SDK as `thinking`; absent leaves the model's default. */
  readonly thinking?: ThinkingLevel
}

/** An import handed to a `/control` agent, and whether its MCP servers are on (`THEOCLAW_IMPORTED_MCP`). */
export interface AgentImport {
  readonly setup: ImportedSetup
  readonly mcp: boolean
}

export interface TheoClawAgentInput<Model extends string | ModelSelection> {
  readonly model: Model
  readonly apiKey: string
  /** The published tools and the path veto (`agentToolOptions`); absent for an agent with no tool. */
  readonly toolOptions?: AgentToolOptions
  /** A migration import (FR-008); absent for every channel and session agent (FR-009). */
  readonly imported?: AgentImport
  /** The hook fingerprints the owner approved (`THEOCLAW_APPROVED_HOOKS`); absent refuses every hook. */
  readonly approvedHooks?: ReadonlySet<string>
  /** SDK telemetry for every agent while `THEOCLAW_OTEL=on` (B-400 FR-006). */
  readonly telemetry?: AgentTelemetry
  readonly thinking?: ThinkingLevel
  /** The `THEOCLAW_PROVIDERS` plugins (OC-119); added to every agent so `<provider>/<model>` resolves. */
  readonly providers?: readonly Plugin[]
  /** A workspace whose `.theokit/plugins/` holds installed, trusted plugins (OC-75); absent loads none. */
  readonly pluginWorkspace?: string
  /** A directory holding `<skill>/SKILL.md` folders (`<workspace>/skills`), offered to the agent; absent offers none. */
  readonly skillsDir?: string
  /** The user's skills directory; a workspace skill of the same name wins over it. */
  readonly userSkillsDir?: string
  /** The system agent (the owner's `/control` agent) also gets the custodian skills (OC-137). */
  readonly custodian?: boolean
}

/**
 * The one place an agent's options are assembled: memory off, the builtin `shell` withheld and the
 * hook gate, always, plus the tool options when the agent has tools.
 */
export function theoClawAgentOptions<Model extends string | ModelSelection>(
  input: TheoClawAgentInput<Model>,
): TheoClawAgentOptions<Model> {
  const base = {
    model: input.model,
    apiKey: input.apiKey,
    withheldBuiltinTools: ['shell'] as const,
    memory: input.toolOptions?.memory ?? ({ enabled: false } as const),
    systemPrompt: UNTRUSTED_CONTENT_NOTICE,
    sendDefaults: untrustedContentSendOptions(),
    local: {
      hooks: createHookApprovalGate(input.approvedHooks ?? new Set()),
      ...(input.pluginWorkspace === undefined ? {} : { cwd: input.pluginWorkspace }),
      ...settingSourcesFor(input),
    },
    ...(input.telemetry === undefined ? {} : { telemetry: input.telemetry }),
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
  }
  const withTools: TheoClawAgentOptions<Model> = input.toolOptions === undefined ? base : withToolOptions(base, input.toolOptions)
  // `bundledDirs` rather than `skillsDir`: the SDK reads `skillsDir` only with the `project` setting
  // source, which would also load project hooks. It takes the first skill of a name, so workspace first.
  const dirs = skillRoots(input)
  const custodian = input.custodian === true ? custodianSkills() : []
  const imported = input.imported?.setup.skills ?? []
  const withSkills: TheoClawAgentOptions<Model> = {
    ...withTools,
    skills: { ...dirSettings(dirs), inline: mergeByName(imported, custodian, bundledSkills()) },
    // Roots are listed again each turn: a plugin skill folder added mid-session is found.
    skillsRefresh: () => resolveSkills(skillRoots(input), imported, custodian),
  }
  const importedOptions = input.imported === undefined ? withSkills : withImport(withSkills, input.imported)
  const skilled = withSkillRead(withProviders(importedOptions, input.providers))
  const suffix = input.toolOptions?.systemPromptSuffix
  return suffix === undefined || suffix === '' ? skilled : { ...skilled, systemPrompt: `${skilled.systemPrompt}\n\n${suffix}` }
}

/**
 * The setting sources an agent loads: `plugins` for a plugin workspace, and `project` only once an
 * approved hook fingerprint exists, so the SDK reads project hooks that the gate then vets one by one.
 */
function settingSourcesFor(input: TheoClawAgentInput<string | ModelSelection>): { settingSources?: Array<'plugins' | 'project'> } {
  const sources: Array<'plugins' | 'project'> = []
  if (input.pluginWorkspace !== undefined) sources.push('plugins')
  if (input.approvedHooks !== undefined && input.approvedHooks.size > 0) sources.push('project')
  return sources.length === 0 ? {} : { settingSources: sources }
}

function projectSourceOn(input: TheoClawAgentInput<string | ModelSelection>): boolean {
  return input.approvedHooks !== undefined && input.approvedHooks.size > 0
}

/**
 * Every directory skills are discovered from, in precedence order (the SDK takes the first skill of a
 * name): workspace, user, then, with the `project` source on, the project roots (`.theokit`, and the
 * compat adapters `.theokit/config.json` lists) and each plugin's `skills` folder. The SDK, the `requires:` adapter and `skill_read` all use this one list.
 */
function skillRoots(input: TheoClawAgentInput<string | ModelSelection>): string[] {
  const roots = [input.skillsDir, input.userSkillsDir].filter((dir): dir is string => dir !== undefined)
  if (!projectSourceOn(input)) return roots
  return [...roots, ...projectSkillRoots(input.pluginWorkspace ?? process.cwd())]
}

/**
 * The skill folders the SDK reads once the `project` setting source is on: the project config roots
 * (`.theokit`, and `.claude` when `.theokit/config.json` lists the `claude-code` compat adapter), then each
 * plugin bundle's `skills`. The SDK keeps this private, so it is mirrored here to gate and read what it offers.
 */
type CompatSource = string | { kind?: string; import?: string[] }

function compatSources(cwd: string): CompatSource[] {
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, '.theokit', 'config.json'), 'utf8')) as { compat?: { adapters?: unknown } }
    return Array.isArray(parsed.compat?.adapters) ? (parsed.compat.adapters as CompatSource[]) : []
  } catch {
    return []
  }
}

const kindOf = (source: CompatSource): string | undefined => (typeof source === 'string' ? source : source.kind)
const admits = (source: CompatSource, surface: string): boolean => typeof source === 'string' || (source.import ?? []).includes(surface)

function configRoots(cwd: string, sources: CompatSource[], surface: string): string[] {
  const native = sources.filter((source) => kindOf(source) === 'theokit')
  const own = native.length === 0 || native.some((source) => admits(source, surface)) ? [join(cwd, '.theokit')] : []
  const claude = sources.some((source) => kindOf(source) === 'claude-code' && admits(source, surface)) ? [join(cwd, '.claude')] : []
  return [...own, ...claude]
}

/** Project skill folders, then plugin skill folders, in the order the SDK searches them. */
function projectSkillRoots(cwd: string): string[] {
  const sources = compatSources(cwd)
  const bundles: string[] = []
  for (const root of configRoots(cwd, sources, 'plugins')) {
    const plugins = join(root, 'plugins')
    try {
      for (const entry of readdirSync(plugins, { withFileTypes: true })) if (entry.isDirectory()) bundles.push(join(plugins, entry.name, 'skills'))
    } catch {
      // No plugins folder here.
    }
  }
  return [...configRoots(cwd, sources, 'skills').map((root) => join(root, 'skills')), ...bundles]
}

/** `options` with the custom provider plugins after its own. */
function withProviders<Model extends string | ModelSelection>(options: TheoClawAgentOptions<Model>, providers: readonly Plugin[] | undefined): TheoClawAgentOptions<Model> {
  return providers === undefined || providers.length === 0 ? options : { ...options, plugins: [...(options.plugins ?? []), ...providers] }
}

/** `base` plus the tool options: the tools, the plugins, and the browser and external servers. */
function withToolOptions<Model extends string | ModelSelection>(
  base: TheoClawAgentOptions<Model>,
  toolOptions: AgentToolOptions,
): TheoClawAgentOptions<Model> {
  const { tools, plugins, mcpServers } = toolOptions
  // Copied one level: the SDK takes mutable arrays and maps, so each agent gets its own list and
  // its own server map; a server's own `headers`, `env` and `args` are shared, and the SDK reads them only.
  return {
    ...base,
    tools: [...tools],
    plugins: [...plugins],
    ...(mcpServers === undefined ? {} : { mcpServers: { ...mcpServers } }),
  }
}

/** The notice, then the import's instructions, then its memory under a read-only heading. */
function importedPrompt(setup: ImportedSetup): string {
  const memory = setup.memory === '' ? '' : `## Imported memory (read-only)\n\n${setup.memory}`
  return [UNTRUSTED_CONTENT_NOTICE, setup.instructions, memory].filter((part) => part !== '').join('\n\n')
}

/**
 * `options` plus what the import gives a `/control` agent (FR-008): the system prompt and the MCP servers only when they are on. Memory stays off and
 * `shell` withheld, as for every agent.
 */
function withImport<Model extends string | ModelSelection>(
  options: TheoClawAgentOptions<Model>,
  imported: AgentImport,
): TheoClawAgentOptions<Model> {
  const { setup, mcp } = imported
  const hasServers = mcp && Object.keys(setup.mcpServers).length > 0
  return {
    ...options,
    systemPrompt: importedPrompt(setup),
    // The browser server and the external tools file's servers keep their names: an imported
    // server with one of them does not replace it.
    ...(hasServers ? { mcpServers: { ...setup.mcpServers, ...options.mcpServers } } : {}),
  }
}

/**
 * The directory settings. `skillsDir` names the first root again, so that when the `project` source
 * is on the SDK does not search its own project and plugin roots ahead of ours: `skillRoots` already
 * lists them, in order, and the adapter and `skill_read` read the same list. Without `project` the SDK ignores it.
 */
function dirSettings(dirs: string[]): Pick<TheoClawSkills, 'bundledDirs' | 'skillsDir'> {
  return { bundledDirs: dirs, ...(dirs[0] === undefined ? {} : { skillsDir: dirs[0] }) }
}

/** Later lists win a name; the SDK also lets an inline skill beat a discovered one, which `resolveSkills` guards against. */
function mergeByName(...lists: ReadonlyArray<readonly InlineSkill[]>): InlineSkill[] {
  const byName = new Map<string, InlineSkill>()
  for (const skill of lists.flat()) byName.set(skill.name, skill)
  return [...byName.values()]
}

/**
 * The skills settings for one turn. A skill folder's skill, as the SDK discovers it (so a skill the SDK
 * rejects does not count), beats an imported, custodian or bundled skill of the same name; a folder
 * skill that still says `requires:` goes inline with its binaries. Rebuilt on every turn (OC-72).
 */
async function resolveSkills(dirs: string[], imported: readonly InlineSkill[], custodian: readonly InlineSkill[]): Promise<TheoClawSkills> {
  const winners = await discoverWinners(dirs)
  const names = new Set(winners.map((skill) => skill.name))
  const ours = mergeByName(imported, custodian, bundledSkills()).filter((skill) => !names.has(skill.name))
  return { ...dirSettings(dirs), inline: [...ours, ...(await legacyRequiresSkills(winners))] }
}

/** Every agent gets `skill_read`, so the model can read a body the prompt block lists by name only. */
function withSkillRead<Model extends string | ModelSelection>(options: TheoClawAgentOptions<Model>): TheoClawAgentOptions<Model> {
  const refresh = options.skillsRefresh
  if (refresh === undefined) return options
  // A function source is re-evaluated on every call, so skill_read stays in step with the refreshed list.
  // It reads only what the model is offered: no skill hidden from it, none whose binary is missing.
  const readable = async (): Promise<Array<InlineSkill | Skill>> => {
    const settings = await refresh()
    const byName = new Map<string, InlineSkill | Skill>()
    for (const skill of await discoverWinners(settings.bundledDirs)) byName.set(skill.name, skill)
    for (const skill of settings.inline) byName.set(skill.name, skill)
    return [...byName.values()].filter((skill) => skill.disableModelInvocation !== true && (skill.requiresBins ?? []).every((bin) => binaryOnPath(bin)))
  }
  return { ...options, tools: [...(options.tools ?? []), SkillReadTool.create(readable)] }
}

/**
 * The `skills` the SDK is given to a session that outlives its turns. A `/control` agent and a
 * WebChat agent are created per turn, so `createTheoClawAgent` reads the folder afresh each time.
 * Freshness comes from here: with `skillsRefresh` it is a resolver the
 * SDK runs on every `send()` (also on a cached `getOrCreate` agent), so the skill list is rebuilt per
 * turn without recreating the session or losing its history.
 */
export function withSdkSkills<T extends { skills?: unknown }>(options: T): Omit<T, 'skillsRefresh'> {
  const { skillsRefresh, ...rest } = options as T & { skillsRefresh?: () => Promise<TheoClawSkills> }
  return skillsRefresh === undefined ? rest : { ...rest, skills: skillsRefresh }
}

/** Create the agent those options describe, through the SDK. */
export async function createTheoClawAgent<Model extends string | ModelSelection>(
  options: TheoClawAgentOptions<Model>,
): Promise<SDKAgent> {
  const skills = options.skillsRefresh === undefined ? options.skills : await options.skillsRefresh()
  return Agent.create({
    model: options.model,
    apiKey: options.apiKey,
    withheldBuiltinTools: [...options.withheldBuiltinTools],
    memory: options.memory,
    local: options.local,
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    ...(options.plugins === undefined ? {} : { plugins: options.plugins }),
    systemPrompt: options.systemPrompt,
    sendDefaults: options.sendDefaults,
    ...(options.modelFallback === undefined ? {} : { modelFallback: options.modelFallback }),
    ...(skills === undefined ? {} : { skills }),
    ...(options.mcpServers === undefined ? {} : { mcpServers: options.mcpServers }),
    ...(options.telemetry === undefined ? {} : { telemetry: { ...options.telemetry } }),
    ...(options.thinking === undefined ? {} : { thinking: options.thinking }),
  })
}
