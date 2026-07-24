/**
 * agentsPlugin() — TheoKit dev-server plugin for agent routes.
 *
 * Mirrors httpDecoratorsPlugin() pattern. Registers agent HTTP endpoints
 * (POST /chat, GET /runs/:id) via the TheoKit plugin hook system.
 *
 * Per ADR D6: structural { name, register } shape (no compile-time theokit dep).
 */

import { type CompiledAgentOptions } from './bridge/agent-compiler.js'
import { generateAgentRoutes, type AgentRoute } from './bridge/agent-route-generator.js'
import type { StreamEvent } from './bridge/agent-sse-handler.js'

/**
 * An agent the plugin mounts: its name, route and already-compiled options (from `applyCapabilities`).
 */
export interface PluginAgentEntry {
  readonly name: string
  readonly route: string
  readonly compiled: CompiledAgentOptions
}

/** Route/name identity used to detect duplicate agent routes. */
export interface RouteIdentity {
  readonly route: string
  readonly agentConfig: { name: string }
}

/** Fail fast on two agents mounting the same route. */
function validateUniqueRoutes(results: readonly RouteIdentity[]): void {
  const seen = new Map<string, string>()
  for (const r of results) {
    const existing = seen.get(r.route)
    if (existing !== undefined) {
      throw new Error(
        `[@theokit/agents] Duplicate agent route '${r.route}': ` +
          `both '${existing}' and '${r.agentConfig.name}' declare it.`,
      )
    }
    seen.set(r.route, r.agentConfig.name)
  }
}

export interface AgentsPluginOptions {
  /** Agents to mount: prepared entries built by `applyCapabilities`. */
  agents: PluginAgentEntry[]
  /** Toolbox classes (or use @Mixin on agents). */
  toolboxes?: Function[]
  /** Factory that creates agent runs — bridges to SDK Agent.create() + agent.send(). */
  createRunFactory?: (
    compiled: CompiledAgentOptions,
  ) => (message: string, sessionId: string) => AsyncIterable<StreamEvent>
}

interface PluginApp {
  addHook(name: string, fn: (ctx: { request: Request }) => Promise<Response | undefined>): void
}

/**
 * Create a TheoKit plugin that mounts agent routes.
 * Web Standard Request/Response — runtime-agnostic.
 */
export function agentsPlugin(opts: AgentsPluginOptions) {
  let routes: CompiledRoute[] | null = null

  return {
    name: '@theokit/agents',

    register(app: PluginApp) {
      app.addHook('onRequest', async (pluginCtx) => {
        routes ??= initRoutes(opts)

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
function initRoutes(opts: AgentsPluginOptions): CompiledRoute[] {
  const allRoutes: AgentRoute[] = []
  const routeIdentities: RouteIdentity[] = []

  for (const entry of opts.agents) {
    routeIdentities.push({ route: entry.route, agentConfig: { name: entry.name } })

    const createRun = opts.createRunFactory
      ? opts.createRunFactory(entry.compiled)
      : defaultCreateRun(entry.compiled)

    allRoutes.push(
      ...generateAgentRoutes({
        walkResult: { route: entry.route },
        compiledOptions: entry.compiled,
        createRun,
      }),
    )
  }

  validateUniqueRoutes(routeIdentities)
  return compileRoutePatterns(allRoutes)
}

/** Default run factory — returns a mock stream when SDK not wired. */
function defaultCreateRun(compiled: CompiledAgentOptions) {
  return async function* (_message: string, _sessionId: string): AsyncGenerator<StreamEvent> {
    await Promise.resolve() // yield to event loop for async contract
    yield {
      type: 'run_started',
      runId: `run-${Date.now()}`,
      agentName: compiled.model ?? 'unknown',
    }
    yield {
      type: 'error',
      code: 'SDK_NOT_WIRED',
      message:
        'No createRunFactory provided — wire @theokit/sdk Agent.create() to enable real agent execution.',
      retryable: false,
    }
  }
}

interface CompiledRoute extends AgentRoute {
  regex?: RegExp
}

/** Pre-compile route patterns for efficient matching. */
function compileRoutePatterns(routes: AgentRoute[]): CompiledRoute[] {
  return routes.map((r) => {
    if (!r.path.includes(':')) return r
    const regexSource = r.path.replace(/:[^/]+/g, '[^/]+')
    return { ...r, regex: RegExp(`^${regexSource}$`) }
  })
}

/** Simple route matcher — checks method + path prefix. */
function matchRoute(
  routes: CompiledRoute[],
  method: string,
  pathname: string,
): CompiledRoute | undefined {
  return routes.find((r) => {
    if (r.method !== method) return false
    if (r.regex) return r.regex.test(pathname)
    return r.path === pathname
  })
}
