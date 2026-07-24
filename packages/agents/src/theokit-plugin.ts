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
import {
  walkAgentMetadata,
  validateUniqueRoutes,
  type AgentWalkResult,
  type RouteIdentity,
} from './bridge/walk-agent-metadata.js'
import { getMixins } from './decorators/mixin.js'

/**
 * M53 — an agent the plugin can mount. A decorated CLASS still works (resolved through
 * `pluginAgentEntry`); a capability-authored agent passes its name, route and compiled options.
 */
export interface PluginAgentEntry {
  readonly name: string
  readonly route: string
  readonly compiled: CompiledAgentOptions
}

export interface AgentsPluginOptions {
  /** Agents to mount: prepared entries, or classes decorated with `@Agent()`. */
  agents: (Function | PluginAgentEntry)[]
  /** Toolbox classes (or use @Mixin on agents). */
  toolboxes?: Function[]
  /** Factory that creates agent runs — bridges to SDK Agent.create() + agent.send(). */
  createRunFactory?: (
    compiled: CompiledAgentOptions,
    /** Present only for the decorated-class form — absent for a prepared entry (M53). */
    walkResult?: AgentWalkResult,
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
  const walkResults: RouteIdentity[] = []

  for (const source of opts.agents) {
    const { entry, walkResult } = resolveAgentEntry(source, opts.toolboxes ?? [])
    walkResults.push(walkResult ?? { route: entry.route, agentConfig: { name: entry.name } })

    const createRun = opts.createRunFactory
      ? opts.createRunFactory(entry.compiled, walkResult)
      : defaultCreateRun(entry.compiled)

    allRoutes.push(
      ...generateAgentRoutes({
        walkResult: { route: entry.route },
        compiledOptions: entry.compiled,
        createRun,
      }),
    )
  }

  validateUniqueRoutes(walkResults)
  return compileRoutePatterns(allRoutes)
}

/** Resolve either form into the entry the plugin mounts (the walk survives only for the class form). */
function resolveAgentEntry(
  source: Function | PluginAgentEntry,
  toolboxes: Function[],
): { entry: PluginAgentEntry; walkResult?: AgentWalkResult } {
  if (typeof source !== 'function') return { entry: source }
  const walkResult = walkAgentMetadata(source, [...toolboxes, ...getMixins(source)])
  return {
    entry: {
      name: walkResult.agentConfig.name,
      route: walkResult.route,
      compiled: compileAgent(walkResult, new Map()),
    },
    walkResult,
  }
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
