/**
 * Agent compiler — transforms decorator metadata into SDK calls.
 *
 * Per ADR D1: @Agent is a macro over Agent.create().
 * Per ADR D3: @Tool compiles to defineTool().
 *
 * EC-3: throws if toolbox instance is missing from the instances map.
 */
import type {
  ContextSettings,
  SettingSource,
  SkillsSettings,
  SystemPromptResolver,
} from '@theokit/sdk'

import { getAgentConfig } from '../decorators/agent.js'
import type { CheckpointOptions } from '../decorators/checkpoint.js'
import type { HumanInTheLoopOptions } from '../decorators/human-in-the-loop.js'
import type { McpServersMap } from '../decorators/mcp.js'
import type { MemoryOptions } from '../decorators/memory.js'
import type { ProjectContextOptions } from '../decorators/project-context.js'
import type { Guardrail } from '../guardrails/index.js'
import type { SkillsSelection } from '../skills-resolver.js'
import type { ReasoningEffort } from '../types.js'

import { compileContextWindow } from './compile-context-window.js'
import { compileSkills } from './compile-skills.js'
import type { ToolboxWalkResult, AgentWalkResult } from './walk-agent-metadata.js'

/** Minimal interface matching defineTool() result shape. */
export interface CompiledTool {
  name: string
  description: string
  inputSchema: unknown
  /**
   * M7 — the optional 2nd `ctx` arg carries the SDK run context: `ctx.context` is the
   * `defineAgent({ context })` / per-run value, `ctx.signal` the abort signal. Optional so the
   * decorator `@Tool` handlers (which ignore it) stay assignable. The SDK calls the tool with
   * both args; a handler that needs run-context (e.g. a filesystem tool reading `projectRoot`)
   * reads `ctx?.context`.
   */
  handler: (
    input: unknown,
    ctx?: { signal?: AbortSignal; context?: unknown },
  ) => string | Promise<string>
}

/**
 * The runtime name the SDK loop reports in `pre_tool_call` — `namespace.tool` when a toolbox
 * declares a namespace, else the bare tool name. Single source of this convention (DRY): both
 * {@link compileTools} and {@link compileHitlGates} key off it, so the HITL gate map and the SDK
 * tool registry can never disagree on a name.
 */
export function toolRuntimeName(namespace: string, toolName: string): string {
  return namespace ? `${namespace}.${toolName}` : toolName
}

/**
 * Build the HITL gate map: runtime tool name → its `@HumanInTheLoop` config, for every gated tool.
 * The HITL plugin ({@link createHitlPlugin}) pauses the run only for tools present here. Empty map
 * ⇒ no gated tools ⇒ the non-HITL stream path (M2, byte-unchanged).
 */
export function compileHitlGates(
  toolboxes: ToolboxWalkResult[],
): Map<string, HumanInTheLoopOptions> {
  const gates = new Map<string, HumanInTheLoopOptions>()
  for (const tb of toolboxes) {
    for (const tool of tb.tools) {
      if (tool.hitl) {
        gates.set(toolRuntimeName(tb.namespace, tool.config.name), tool.hitl)
      }
    }
  }
  return gates
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
      const handler = (instance as unknown as Record<string | symbol, Function>)[tool.propertyKey]
      if (typeof handler !== 'function') {
        throw new Error(
          `[@theokit/agents] Toolbox ${tb.class.name}: '${String(tool.propertyKey)}' is not a function.`,
        )
      }

      const name = toolRuntimeName(tb.namespace, tool.config.name)

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
  /**
   * theokit-file-based-config — opt-in `.theokit/` file-based config roots (`"project"`/`"user"`/…).
   * Projected into `Agent.create({ local: { settingSources } })` by `assembleM8CreateOptions`
   * (merged with `cwd`, decoupled from inline skills). Absent ⇒ inline (code) config only.
   */
  settingSources?: readonly SettingSource[]
  /** Code `Plugin` objects forwarded to `Agent.create({ plugins })` (lifecycle-hook seam). */
  plugins?: readonly unknown[]
  tools: CompiledTool[]
  agents: Record<string, CompiledSubAgent>
  memory?: MemoryOptions
  skills?: SkillsSettings
  context?: ContextSettings
  /**
   * M7 — run-context injected into every tool handler's `ctx.context` by the theokit adapter
   * (`buildSdkTools` wrapper). Populated by `defineAgent({ context })` (functional surface).
   * NAME NOTE: distinct from the context-window `context` (`ContextSettings`) above — this is
   * per-run user data for tools, not token-budget config.
   */
  runContext?: Record<string, unknown>
  /** Raw @ProjectContext config; the adapter builds the (async) systemPrompt resolver from it. */
  projectContext?: ProjectContextOptions
  mcpServers?: McpServersMap
  maxIterations?: number
  timeoutMs?: number
  stream: boolean
  /**
   * HITL gate map (M4): runtime tool name → `@HumanInTheLoop` config. Absent/empty ⇒ no gated
   * tools. The harness (`mountAgent`) turns this into the `pre_tool_call` pause wiring.
   */
  hitl?: Map<string, HumanInTheLoopOptions>
  /**
   * `@Checkpoint` config (M4): when present the harness emits `checkpoint_saved` and selects the
   * durable SDK conversation storage (`storage: 'filesystem'`) so a same-`sessionId` request resumes.
   */
  checkpoint?: CheckpointOptions
  /**
   * M9 — guardrails: input/output guards applied at the framework boundary (ADR-0040 § D2).
   * Input guards run on the user message BEFORE the SDK runtime sees it (fail-fast on `block`).
   * They REUSE the runtime; they never reimplement it. Absent/empty ⇒ no guards.
   */
  guardrails?: readonly Guardrail[]
  /**
   * M13 — per-request skills resolver (from `defineAgent({ skills: (ctx) => [...] })`). The request
   * path resolves it against the run-context (`resolveEnabledSkills`) and sets `skills.enabled`
   * before the SDK runs. Not consumed by the SDK directly (it reads `skills`). Absent ⇒ no resolver.
   */
  skillsResolver?: SkillsSelection
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
  const hitl = compileHitlGates(walkResult.toolboxes)

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
    guardrails: walkResult.guardrails,
    maxIterations: walkResult.mainLoop.maxIterations ?? walkResult.agentConfig.maxIterations,
    timeoutMs: walkResult.mainLoop.timeoutMs ?? walkResult.agentConfig.timeoutMs,
    stream: walkResult.agentConfig.stream ?? true,
    hitl: hitl.size > 0 ? hitl : undefined,
    checkpoint: walkResult.checkpoint,
  }
}
