/**
 * Walk decorator metadata on agent + toolbox classes.
 * Mirrors http-decorators' walkControllerMetadata() pattern.
 *
 * EC-1: throws if @Agent class is missing @MainLoop.
 * EC-4: throws on duplicate routes across agents.
 */
import 'reflect-metadata'

import { Reflector } from '@theokit/http'

import type { GatewayOptions } from '../decorators/gateway.js'
import { getGatewayConfig } from '../decorators/gateway.js'
import { getMcpConfig } from '../decorators/mcp.js'
import type { McpServersMap } from '../decorators/mcp.js'
import { getMemoryConfig } from '../decorators/memory.js'
import type { MemoryOptions } from '../decorators/memory.js'
import { Trace, Audit } from '../decorators/observability.js'
import { RequiresApproval, Budget } from '../decorators/policies.js'
import { getSkillsConfig } from '../decorators/skills.js'
import type { SkillsOptions } from '../decorators/skills.js'
import { getSubAgents } from '../decorators/sub-agents.js'
import { getMeta } from '../metadata/index.js'
import {
  AGENT_CONFIG,
  AGENT_MAIN_LOOP,
  TOOLBOX_CONFIG,
  TOOL_CONFIG,
  TOOL_METHODS,
} from '../metadata/keys.js'
import type {
  AgentOptions,
  MainLoopMeta,
  ToolboxOptions,
  ToolOptions,
  ApprovalOptions,
  BudgetOptions,
} from '../types.js'

// http-decorators metadata keys for pipeline reuse
const USE_GUARDS = Symbol.for('theokit:http-decorators:use-guards')
const USE_INTERCEPTORS = Symbol.for('theokit:http-decorators:use-interceptors')
const USE_FILTERS = Symbol.for('theokit:http-decorators:use-filters')

/**
 * Stable warning codes for agent pipeline metadata-only decorators.
 * Test by code, not by message string. Document in agent support matrix.
 */
export const AgentWarningCode = {
  INTERCEPTOR_METADATA_ONLY: 'THEO_AGENT_INTERCEPTOR_METADATA_ONLY',
  FILTER_METADATA_ONLY: 'THEO_AGENT_FILTER_METADATA_ONLY',
  BUDGET_TOP_LEVEL_METADATA_ONLY: 'THEO_AGENT_BUDGET_TOP_LEVEL_METADATA_ONLY',
} as const

const reflectorInstance = new Reflector()

export interface AgentWalkResult {
  agentConfig: AgentOptions
  mainLoop: MainLoopMeta
  toolboxes: ToolboxWalkResult[]
  guards: Function[]
  interceptors: Function[]
  filters: Function[]
  route: string
  gateway?: GatewayOptions
  subAgentClasses: Function[]
  memory?: MemoryOptions
  skills?: SkillsOptions
  mcpServers?: McpServersMap
}

export interface ToolboxWalkResult {
  class: Function
  namespace: string
  tools: ToolWalkResult[]
  guards: Function[]
}

export interface ToolWalkResult {
  propertyKey: string | symbol
  config: ToolOptions
  guards: Function[]
  approval?: ApprovalOptions
  capabilities?: string[]
  budget?: BudgetOptions
  trace: boolean
  audit: boolean
}

function walkToolbox(ToolboxClass: Function): ToolboxWalkResult {
  const config = getMeta<ToolboxOptions>(TOOLBOX_CONFIG, ToolboxClass) ?? {}
  const methods = getMeta<(string | symbol)[]>(TOOL_METHODS, ToolboxClass) ?? []
  const classGuards = getMeta<Function[]>(USE_GUARDS, ToolboxClass) ?? []

  const tools: ToolWalkResult[] = methods.map((propertyKey) => {
    const toolConfig = getMeta<ToolOptions>(TOOL_CONFIG, ToolboxClass, propertyKey)
    if (!toolConfig) {
      throw new Error(
        `[@theokit/agents] Toolbox ${ToolboxClass.name}: method '${String(propertyKey)}' is in TOOL_METHODS but has no @Tool() config.`,
      )
    }

    const methodGuards = getMeta<Function[]>(USE_GUARDS, ToolboxClass, propertyKey) ?? []

    // Read typed decorator metadata via Reflector (not generic readTypedMeta)
    const ref = reflectorInstance

    const approvalVal = ref.get(RequiresApproval, ToolboxClass, propertyKey)
    const traceVal = ref.get(Trace, ToolboxClass, propertyKey)
    const auditVal = ref.get(Audit, ToolboxClass, propertyKey)

    return {
      propertyKey,
      config: toolConfig,
      guards: [...classGuards, ...methodGuards],
      approval:
        approvalVal && typeof approvalVal === 'object' && 'reason' in approvalVal
          ? approvalVal
          : undefined,
      capabilities: undefined, // read via RequiresCapability when needed
      budget: undefined, // read via Budget when needed
      trace: traceVal ?? false,
      audit: auditVal ?? false,
    }
  })

  return {
    class: ToolboxClass,
    namespace: config.namespace ?? '',
    tools,
    guards: classGuards,
  }
}

/** WeakMap cache — metadata is immutable; walk once per class. */
const agentWalkCache = new WeakMap<Function, AgentWalkResult>()

/**
 * Walk all metadata on an agent class and its toolboxes.
 * Memoized per AgentClass via WeakMap.
 *
 * @throws Error if @Agent is missing @MainLoop (EC-1)
 */
export function walkAgentMetadata(
  AgentClass: Function,
  toolboxClasses: Function[] = [],
): AgentWalkResult {
  // Cache key is AgentClass only (toolboxes are typically stable per agent)
  if (toolboxClasses.length === 0) {
    const cached = agentWalkCache.get(AgentClass)
    if (cached) return cached
  }
  const agentConfig = getMeta<AgentOptions>(AGENT_CONFIG, AgentClass)
  if (!agentConfig) {
    throw new Error(`[@theokit/agents] Class ${AgentClass.name} is missing @Agent() decorator.`)
  }

  const mainLoop = getMeta<MainLoopMeta>(AGENT_MAIN_LOOP, AgentClass)
  if (!mainLoop) {
    throw new Error(
      `[@theokit/agents] Agent ${AgentClass.name} is missing @MainLoop() decorator. ` +
        `Decorate exactly one method with @MainLoop().`,
    )
  }

  const guards = getMeta<Function[]>(USE_GUARDS, AgentClass) ?? []

  // Interceptors and filters are read but NOT enforced in agent pipeline.
  // Agent pipeline only shares guards with HTTP; interceptors/filters have
  // different lifecycle semantics (HTTP wraps a single handler; agents run
  // a multi-step loop with tool calls, streaming, checkpoints).
  // Warn explicitly so developers don't expect enforcement silently.
  const interceptors = getMeta<Function[]>(USE_INTERCEPTORS, AgentClass) ?? []
  if (interceptors.length > 0) {
    console.warn(
      `[${AgentWarningCode.INTERCEPTOR_METADATA_ONLY}] Agent ${AgentClass.name}: ` +
        `@UseInterceptors is metadata-only on agents and will not execute. ` +
        `Agent pipeline shares guards with HTTP but uses a distinct execution model. ` +
        `Interceptors are reserved for future agent-specific lifecycle hooks.`,
    )
  }

  const filters = getMeta<Function[]>(USE_FILTERS, AgentClass) ?? []
  if (filters.length > 0) {
    console.warn(
      `[${AgentWarningCode.FILTER_METADATA_ONLY}] Agent ${AgentClass.name}: ` +
        `@UseFilters is metadata-only on agents and will not catch agent runtime errors. ` +
        `Agent errors flow through SSE error events, not HTTP exception filters. ` +
        `Filters are reserved for future agent-specific error handling.`,
    )
  }

  // @Budget on agent class: metadata-only for top-level agents.
  // Budget enforcement is active only in delegate() (sub-agent calls) where
  // the orchestrator clamps cost mid-stream. Top-level agent budget depends
  // on the SDK's cost reporting in DoneEvent.
  const agentBudget = reflectorInstance.get(Budget, AgentClass)
  if (agentBudget) {
    console.warn(
      `[${AgentWarningCode.BUDGET_TOP_LEVEL_METADATA_ONLY}] Agent ${AgentClass.name}: ` +
        `@Budget on top-level agents is metadata-only in this version. ` +
        `Budget enforcement currently applies to delegate() calls only. ` +
        `Top-level run enforcement will be wired through SDK cost tracking in a future release.`,
    )
  }

  const toolboxes = toolboxClasses.map(walkToolbox)
  const gateway = getGatewayConfig(AgentClass)
  const subAgentClasses = getSubAgents(AgentClass)
  const memory = getMemoryConfig(AgentClass)
  const skills = getSkillsConfig(AgentClass)
  const mcpServers = getMcpConfig(AgentClass)

  const result: AgentWalkResult = {
    agentConfig,
    mainLoop,
    toolboxes,
    guards,
    interceptors,
    filters,
    route: agentConfig.route,
    gateway,
    subAgentClasses,
    memory,
    skills,
    mcpServers,
  }

  if (toolboxClasses.length === 0) {
    agentWalkCache.set(AgentClass, result)
  }
  return result
}

/**
 * Validate that no two agents share the same route prefix.
 *
 * @throws Error on duplicate routes (EC-4)
 */
export function validateUniqueRoutes(results: AgentWalkResult[]): void {
  const seen = new Map<string, string>()
  for (const r of results) {
    const existing = seen.get(r.route)
    if (existing) {
      throw new Error(
        `[@theokit/agents] Duplicate agent route '${r.route}': ` +
          `both '${existing}' and '${r.agentConfig.name}' declare it.`,
      )
    }
    seen.set(r.route, r.agentConfig.name)
  }
}
