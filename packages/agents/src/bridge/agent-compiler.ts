/**
 * Agent compiler — transforms decorator metadata into SDK calls.
 *
 * Per ADR D1: @Agent is a macro over Agent.create().
 * Per ADR D3: @Tool compiles to defineTool().
 *
 * EC-3: throws if toolbox instance is missing from the instances map.
 */
import { getAgentConfig } from '../decorators/agent.js'
import type { McpServersMap } from '../decorators/mcp.js'
import type { MemoryOptions } from '../decorators/memory.js'
import type { SkillsOptions } from '../decorators/skills.js'

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

      const name = tb.namespace
        ? `${tb.namespace}.${tool.config.name}`
        : tool.config.name

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
  systemPrompt?: string
}

/** Compiled agent options ready for SDK Agent.create(). */
export interface CompiledAgentOptions {
  model?: string
  systemPrompt?: string
  tools: CompiledTool[]
  agents: Record<string, CompiledSubAgent>
  memory?: MemoryOptions
  skills?: SkillsOptions
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
    systemPrompt: walkResult.agentConfig.systemPrompt,
    tools,
    agents,
    memory: walkResult.memory,
    skills: walkResult.skills,
    mcpServers: walkResult.mcpServers,
    maxIterations: walkResult.mainLoop.maxIterations ?? walkResult.agentConfig.maxIterations,
    timeoutMs: walkResult.mainLoop.timeoutMs ?? walkResult.agentConfig.timeoutMs,
    stream: walkResult.agentConfig.stream ?? true,
  }
}
