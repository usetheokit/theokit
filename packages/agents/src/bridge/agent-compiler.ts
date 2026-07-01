/**
 * Agent compiler — transforms decorator metadata into SDK calls.
 *
 * Per ADR D1: @Agent is a macro over Agent.create().
 * Per ADR D3: @Tool compiles to defineTool().
 *
 * EC-3: throws if toolbox instance is missing from the instances map.
 */
import type { ContextSettings, SkillsSettings, SystemPromptResolver } from '@theokit/sdk'

import { getAgentConfig } from '../decorators/agent.js'
import type { McpServersMap } from '../decorators/mcp.js'
import type { MemoryOptions } from '../decorators/memory.js'
import type { ProjectContextOptions } from '../decorators/project-context.js'
import type { ReasoningEffort } from '../types.js'

import { compileContextWindow } from './compile-context-window.js'
import { compileSkills } from './compile-skills.js'
import type { ToolboxWalkResult, AgentWalkResult } from './walk-agent-metadata.js'

/** Minimal interface matching defineTool() result shape. */
export interface CompiledTool {
  name: string
  description: string
  inputSchema: unknown
  handler: (input: unknown) => string | Promise<string>
}

/**
 * Compile @Tool metadata into tool definitions.
 *
 * @param toolboxes - Walked toolbox metadata
 * @param toolboxInstances - Map of Toolbox class → instantiated object (for `this` binding)
 */
export function compileTools(
  toolboxes: ToolboxWalkResult[],
  toolboxInstances: Map<Function, object>,
): CompiledTool[] {
  const tools: CompiledTool[] = []

  for (const tb of toolboxes) {
    // EC-3: guard against missing toolbox instance
    const instance = toolboxInstances.get(tb.class)
    if (!instance) {
      throw new Error(
        `[@theokit/agents] Toolbox ${tb.class.name} not instantiated — add to providers or pass instances.`,
      )
    }

    for (const tool of tb.tools) {
      const handler = (instance as Record<string | symbol, Function>)[tool.propertyKey]
      if (typeof handler !== 'function') {
        throw new Error(
          `[@theokit/agents] Toolbox ${tb.class.name}: '${String(tool.propertyKey)}' is not a function.`,
        )
      }

      const name = tb.namespace ? `${tb.namespace}.${tool.config.name}` : tool.config.name

      tools.push({
        name,
        description: tool.config.description,
        inputSchema: tool.config.input,
        handler: (input: unknown) => handler.call(instance, input) as string | Promise<string>,
      })
    }
  }

  return tools
}

/** Compiled sub-agent definition matching SDK AgentDefinition shape. */
export interface CompiledSubAgent {
  model?: string
  /**
   * V4-L.1: typed as the union for consistency with `AgentOptions.systemPrompt`,
   * so `compileSubAgents` carries whatever the sub-agent declared. Sub-agent
   * resolver EXECUTION is out of scope this slice (ADR D3): `compiled.agents` is
   * not spread into `Agent.create` by `createSdkAgentStream`; a resolver here is
   * carried, not invoked. Top-level agent resolvers are the supported path.
   */
  systemPrompt?: string | SystemPromptResolver
}

/** Compiled agent options ready for SDK Agent.create(). */
export interface CompiledAgentOptions {
  model?: string
  /** Extended-thinking effort declared via `@Agent({ reasoningEffort })`; mapped to SDK ModelSelection.params. */
  reasoningEffort?: ReasoningEffort
  /** Opt-in `<think>`-tag extraction declared via `@Agent({ parseThinkTags })` (M2); wraps the stream when true. */
  parseThinkTags?: boolean
  /** Opt-in tool-dialect stripping declared via `@Agent({ stripToolDialect })` (theocode#32); strips leaked `<function=…></tool_call>` from text when true. */
  stripToolDialect?: boolean
  /** Opt-in leaked-dialect recovery declared via `@Agent({ recoverLeakedToolCalls })` (theokit#58); enables the SDK route's `extractToolCallsFromContent` so leaked tool calls EXECUTE when true. */
  recoverLeakedToolCalls?: boolean
  /** Static prompt OR a per-request {@link SystemPromptResolver} (V4-L.1, Axis-B). */
  systemPrompt?: string | SystemPromptResolver
  tools: CompiledTool[]
  agents: Record<string, CompiledSubAgent>
  memory?: MemoryOptions
  skills?: SkillsSettings
  context?: ContextSettings
  /** Raw @ProjectContext config; the adapter builds the (async) systemPrompt resolver from it. */
  projectContext?: ProjectContextOptions
  mcpServers?: McpServersMap
  maxIterations?: number
  timeoutMs?: number
  stream: boolean
}

/**
 * Compile @SubAgents references into SDK agents map.
 * Each sub-agent class must have @Agent() metadata.
 */
export function compileSubAgents(subAgentClasses: Function[]): Record<string, CompiledSubAgent> {
  const agents: Record<string, CompiledSubAgent> = {}
  for (const cls of subAgentClasses) {
    const config = getAgentConfig(cls)
    if (!config) continue // validated at decoration time
    agents[config.name] = {
      model: config.model,
      systemPrompt: config.systemPrompt,
    }
  }
  return agents
}

/**
 * Compile @Agent metadata into SDK-compatible options.
 *
 * EC-7: agents without toolboxes produce tools: [].
 */
export function compileAgent(
  walkResult: AgentWalkResult,
  toolboxInstances = new Map<Function, object>(),
): CompiledAgentOptions {
  const tools = compileTools(walkResult.toolboxes, toolboxInstances)
  const agents = compileSubAgents(walkResult.subAgentClasses)

  return {
    model: walkResult.agentConfig.model,
    reasoningEffort: walkResult.agentConfig.reasoningEffort,
    parseThinkTags: walkResult.agentConfig.parseThinkTags,
    stripToolDialect: walkResult.agentConfig.stripToolDialect,
    recoverLeakedToolCalls: walkResult.agentConfig.recoverLeakedToolCalls,
    systemPrompt: walkResult.agentConfig.systemPrompt,
    tools,
    agents,
    memory: walkResult.memory,
    skills: walkResult.skills ? compileSkills(walkResult.skills) : undefined,
    context: walkResult.contextWindow
      ? compileContextWindow(walkResult.contextWindow).context
      : undefined,
    projectContext: walkResult.projectContext,
    mcpServers: walkResult.mcpServers,
    maxIterations: walkResult.mainLoop.maxIterations ?? walkResult.agentConfig.maxIterations,
    timeoutMs: walkResult.mainLoop.timeoutMs ?? walkResult.agentConfig.timeoutMs,
    stream: walkResult.agentConfig.stream ?? true,
  }
}
