import { Agent, SkillReadTool } from '@theokit/sdk'
import type { CustomTool, InlineSkill, McpServerConfig, ModelSelection, Plugin, SDKAgent } from '@theokit/sdk'

import type { ImportedSetup } from '../migration/import-store.js'
import type { AgentToolOptions } from '../tools/tool-registry.js'

/** The options every TheoClaw agent is created with, every one of them. */
export interface TheoClawAgentOptions<Model extends string | ModelSelection = string> {
  /** The `THEOCLAW_MODEL` string in the process; a `{ id, url }` selection in the stub tests. */
  readonly model: Model
  readonly apiKey: string
  /** The SDK registers an unsandboxed `shell` on every local agent; no TheoClaw agent gets it. */
  readonly withheldBuiltinTools: readonly 'shell'[]
  /** Off, so a finished turn writes no transcript under `.theokit/memory/sessions/` in the cwd. */
  readonly memory: { readonly enabled: false }
  readonly tools?: CustomTool[]
  readonly plugins?: Plugin[]
  /** An import's instructions and read-only memory (FR-008); only a `/control` agent has one. */
  readonly systemPrompt?: string
  readonly skills?: { readonly inline: InlineSkill[] }
  /**
   * Only on a `/control` agent: its browser server with `THEOCLAW_BROWSER=on`, the servers its
   * external tools file names, and an import's servers with `THEOCLAW_IMPORTED_MCP` on; never on
   * a chat agent.
   */
  readonly mcpServers?: Record<string, McpServerConfig>
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
}

/**
 * The one place an agent's options are assembled: memory off and the builtin `shell` withheld,
 * always, plus the tool options when the agent has tools.
 */
export function theoClawAgentOptions<Model extends string | ModelSelection>(
  input: TheoClawAgentInput<Model>,
): TheoClawAgentOptions<Model> {
  const base = {
    model: input.model,
    apiKey: input.apiKey,
    withheldBuiltinTools: ['shell'] as const,
    memory: { enabled: false } as const,
  }
  const withTools: TheoClawAgentOptions<Model> = input.toolOptions === undefined ? base : withToolOptions(base, input.toolOptions)
  return input.imported === undefined ? withTools : withImport(withTools, input.imported)
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

/** The import's system prompt: its instructions, then its memory under a read-only heading. */
function importedPrompt(setup: ImportedSetup): string | undefined {
  const memory = setup.memory === '' ? '' : `## Imported memory (read-only)\n\n${setup.memory}`
  const prompt = [setup.instructions, memory].filter((part) => part !== '').join('\n\n')
  return prompt === '' ? undefined : prompt
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
  const systemPrompt = importedPrompt(setup)
  const hasSkills = setup.skills.length > 0
  const hasServers = mcp && Object.keys(setup.mcpServers).length > 0
  return {
    ...options,
    ...(systemPrompt === undefined ? {} : { systemPrompt }),
    ...(hasSkills ? { skills: { inline: [...setup.skills] }, tools: [...(options.tools ?? []), SkillReadTool.create(setup.skills)] } : {}),
    // The browser server and the external tools file's servers keep their names: an imported
    // server with one of them does not replace it.
    ...(hasServers ? { mcpServers: { ...setup.mcpServers, ...options.mcpServers } } : {}),
  }
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
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    ...(options.plugins === undefined ? {} : { plugins: options.plugins }),
    ...(options.systemPrompt === undefined ? {} : { systemPrompt: options.systemPrompt }),
    ...(options.skills === undefined ? {} : { skills: options.skills }),
    ...(options.mcpServers === undefined ? {} : { mcpServers: options.mcpServers }),
  })
}
