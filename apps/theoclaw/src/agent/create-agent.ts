import { Agent, SkillReadTool } from '@theokit/sdk'
import type { CustomTool, HookApprovalGate, InlineSkill, McpServerConfig, ModelSelection, Plugin, SDKAgent } from '@theokit/sdk'

import { custodianSkills } from '../skills/custodian.js'
import { BUNDLED_SKILLS, loadSkillDirectory, SkillRegistry } from '../skills/registry.js'
import type { ImportedSetup } from '../migration/import-store.js'
import type { AgentTelemetry } from '../telemetry/otel.js'
import type { AgentToolOptions } from '../tools/tool-registry.js'
import type { ThinkingLevel } from './failover.js'
import { createHookApprovalGate } from './hook-approval.js'
import { UNTRUSTED_CONTENT_NOTICE } from './untrusted-content.js'

/**
 * The SDK's local options TheoClaw sets. `hooks` is on every agent (B-397 FR-007): the SDK reads a
 * hook gate only here, and throws on a top-level `hooks`. No agent sets `settingSources`, so the SDK
 * loads no project hook today and the gate is defense in depth (plan D3). Whoever adds `cwd` or
 * `sessionDir` merges them into this object, so the gate is never dropped.
 */
export interface TheoClawLocalOptions {
  readonly hooks: HookApprovalGate
  readonly cwd?: string
  readonly sessionDir?: string
  /** `['plugins']` only for an agent given a plugin workspace (OC-75); absent loads no plugin folder. */
  readonly settingSources?: Array<'plugins'>
}

/** The options every TheoClaw agent is created with, every one of them. */
export interface TheoClawAgentOptions<Model extends string | ModelSelection = string> {
  /** The `THEOCLAW_MODEL` string in the process; a `{ id, url }` selection in the stub tests. */
  readonly model: Model
  readonly apiKey: string
  /** The SDK registers an unsandboxed `shell` on every local agent; no TheoClaw agent gets it. */
  readonly withheldBuiltinTools: readonly 'shell'[]
  /** Off, so a finished turn writes no transcript under `.theokit/memory/sessions/` in the cwd. */
  readonly memory: { readonly enabled: false }
  readonly local: TheoClawLocalOptions
  readonly tools?: CustomTool[]
  readonly plugins?: Plugin[]
  /**
   * Opens with `UNTRUSTED_CONTENT_NOTICE` on every agent (B-398 FR-002); a `/control` agent with an
   * import has the import's instructions and read-only memory after it (FR-008).
   */
  readonly systemPrompt: string
  readonly skills?: { readonly inline: InlineSkill[] }
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
    memory: { enabled: false } as const,
    systemPrompt: UNTRUSTED_CONTENT_NOTICE,
    local: {
      hooks: createHookApprovalGate(input.approvedHooks ?? new Set()),
      ...(input.pluginWorkspace === undefined ? {} : { cwd: input.pluginWorkspace, settingSources: ['plugins' as const] }),
    },
    ...(input.telemetry === undefined ? {} : { telemetry: input.telemetry }),
    ...(input.thinking === undefined ? {} : { thinking: input.thinking }),
  }
  const withTools: TheoClawAgentOptions<Model> = input.toolOptions === undefined ? base : withToolOptions(base, input.toolOptions)
  const discovered = mergeSkills(input.custodian === true ? custodianSkills() : [], discoverSkills(input.skillsDir, input.userSkillsDir))
  const withSkills: TheoClawAgentOptions<Model> = discovered.length === 0 ? withTools : { ...withTools, skills: { inline: discovered } }
  const imported = input.imported === undefined ? withSkills : withImport(withSkills, input.imported)
  const skilled = withSkillRead(withProviders(imported, input.providers))
  const suffix = input.toolOptions?.systemPromptSuffix
  return suffix === undefined || suffix === '' ? skilled : { ...skilled, systemPrompt: `${skilled.systemPrompt}\n\n${suffix}` }
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
 * `options` plus what the import gives a `/control` agent (FR-008): the system prompt, the skills
 * inline with a `skill_read` tool, and the MCP servers only when they are on. Memory stays off and
 * `shell` withheld, as for every agent.
 */
function withImport<Model extends string | ModelSelection>(
  options: TheoClawAgentOptions<Model>,
  imported: AgentImport,
): TheoClawAgentOptions<Model> {
  const { setup, mcp } = imported
  const hasSkills = setup.skills.length > 0
  const hasServers = mcp && Object.keys(setup.mcpServers).length > 0
  return {
    ...options,
    systemPrompt: importedPrompt(setup),
    ...(hasSkills ? { skills: { inline: mergeSkills(setup.skills, options.skills?.inline ?? []) } } : {}),
    // The browser server and the external tools file's servers keep their names: an imported
    // server with one of them does not replace it.
    ...(hasServers ? { mcpServers: { ...setup.mcpServers, ...options.mcpServers } } : {}),
  }
}

/** Built-in skills, user skills, then workspace skills (which win by name); a skill whose required binary is missing is left out. */
function discoverSkills(workspaceDir: string | undefined, userDir: string | undefined): InlineSkill[] {
  const user = userDir === undefined ? [] : loadSkillDirectory(userDir, 'bundled')
  const bundled = [...BUNDLED_SKILLS, ...user]
  return new SkillRegistry({ ...(workspaceDir === undefined ? {} : { workspaceDir }), bundled }).inlineSkills()
}

/** Every agent with skills gets `skill_read`, so the model can read a body the prompt block lists by name only. */
function withSkillRead<Model extends string | ModelSelection>(options: TheoClawAgentOptions<Model>): TheoClawAgentOptions<Model> {
  const inline = options.skills?.inline ?? []
  return inline.length === 0 ? options : { ...options, tools: [...(options.tools ?? []), SkillReadTool.create(inline)] }
}

/** Imported skills, then workspace skills: a workspace skill replaces an imported one of the same name. */
function mergeSkills(imported: readonly InlineSkill[], workspace: readonly InlineSkill[]): InlineSkill[] {
  const byName = new Map<string, InlineSkill>()
  for (const skill of [...imported, ...workspace]) byName.set(skill.name, skill)
  return [...byName.values()]
}

/** Create the agent those options describe, through the SDK. */
export function createTheoClawAgent<Model extends string | ModelSelection>(
  options: TheoClawAgentOptions<Model>,
): Promise<SDKAgent> {
  return Agent.create({
    model: options.model,
    apiKey: options.apiKey,
    withheldBuiltinTools: [...options.withheldBuiltinTools],
    memory: options.memory,
    local: options.local,
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    ...(options.plugins === undefined ? {} : { plugins: options.plugins }),
    systemPrompt: options.systemPrompt,
    ...(options.skills === undefined ? {} : { skills: options.skills }),
    ...(options.mcpServers === undefined ? {} : { mcpServers: options.mcpServers }),
    ...(options.telemetry === undefined ? {} : { telemetry: { ...options.telemetry } }),
    ...(options.thinking === undefined ? {} : { thinking: options.thinking }),
  })
}
