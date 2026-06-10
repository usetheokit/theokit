/**
 * agentsPlugin() — TheoKit dev-server plugin for agent routes.
 *
 * Mirrors httpDecoratorsPlugin() pattern. Registers agent HTTP endpoints
 * (POST /chat, GET /runs/:id) via the TheoKit plugin hook system.
 *
 * Per ADR D6: structural { name, register } shape (no compile-time theokit dep).
 */
import 'reflect-metadata'

import { compileAgent, type CompiledAgentOptions } from './bridge/agent-compiler.js'
import { generateAgentRoutes, type AgentRoute } from './bridge/agent-route-generator.js'
import type { StreamEvent } from './bridge/agent-sse-handler.js'
import { walkAgentMetadata, validateUniqueRoutes, type AgentWalkResult } from './bridge/walk-agent-metadata.js'
import { getMixins } from './decorators/mixin.js'

export interface AgentsPluginOptions {
  /** Agent classes decorated with @Agent(). */
  agents: Function[]
  /** Toolbox classes (or use @Mixin on agents). */
  toolboxes?: Function[]
  /** Factory that creates agent runs — bridges to SDK Agent.create() + agent.send(). */
  createRunFactory?: (compiled: CompiledAgentOptions, walkResult: AgentWalkResult) =>
    (message: string, sessionId: string) => AsyncIterable<StreamEvent>
}

interface PluginApp {
  addHook(name: string, fn: (ctx: { request: Request }) => Promise<Response | void>): void
}

/**
 * Create a TheoKit plugin that mounts agent routes.
 * Web Standard Request/Response — runtime-agnostic.
 */
export function agentsPlugin(opts: AgentsPluginOptions) {
  let routes: AgentRoute[] | null = null

  return {
    name: '@theokit/agents',

    register(app: PluginApp) {
      app.addHook('onRequest', async (pluginCtx) => {
        if (!routes) routes = initRoutes(opts)

        const request = pluginCtx.request
        const url = new URL(request.url)
        const method = request.method.toUpperCase()

        const matched = matchRoute(routes, method, url.pathname)
        if (!matched) return // fall through

        return matched.handler(request)
      })
    },
  }
}

/** Initialize routes from agent metadata (once). */
function initRoutes(opts: AgentsPluginOptions): AgentRoute[] {
  const allRoutes: AgentRoute[] = []
  const walkResults: AgentWalkResult[] = []

  for (const AgentClass of opts.agents) {
    // Resolve toolboxes: explicit + @Mixin
    const mixins = getMixins(AgentClass)
    const toolboxes = [...(opts.toolboxes ?? []), ...mixins]

    const walkResult = walkAgentMetadata(AgentClass, toolboxes)
    walkResults.push(walkResult)

    const compiled = compileAgent(walkResult, new Map())
    const createRun = opts.createRunFactory
      ? opts.createRunFactory(compiled, walkResult)
      : defaultCreateRun(compiled)

    const agentRoutes = generateAgentRoutes({
      walkResult,
      compiledOptions: compiled,
      createRun,
    })

    allRoutes.push(...agentRoutes)
  }

  validateUniqueRoutes(walkResults)
  return allRoutes
}

/** Default run factory — returns a mock stream when SDK not wired. */
function defaultCreateRun(compiled: CompiledAgentOptions) {
  return async function* (_message: string, _sessionId: string): AsyncGenerator<StreamEvent> {
    yield {
      type: 'run_started',
      runId: `run-${Date.now()}`,
      agentName: compiled.model ?? 'unknown',
    }
    yield {
      type: 'error',
      code: 'SDK_NOT_WIRED',
      message: 'No createRunFactory provided — wire @theokit/sdk Agent.create() to enable real agent execution.',
      retryable: false,
    }
  }
}

/** Simple route matcher — checks method + path prefix. */
function matchRoute(routes: AgentRoute[], method: string, pathname: string): AgentRoute | undefined {
  return routes.find((r) => {
    if (r.method !== method) return false
    // Handle :param patterns
    if (r.path.includes(':')) {
      const pattern = r.path.replace(/:[^/]+/g, '[^/]+')
      return new RegExp(`^${pattern}$`).test(pathname)
    }
    return r.path === pathname
  })
}
