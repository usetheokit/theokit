/**
 * @Agent() — marks a class as an AI agent controller.
 *
 * M47 reconciliation (ADR-M47-3): `@Agent` (a class IS the agent), `@Expose` (binds a separately-built
 * `agent()…build()` to a controller), and the `agents/*.ts` file convention are three AUTHORING surfaces
 * over the ONE runtime — `mountAgent`. None owns a parallel agent runtime (a grep gate proves no second
 * streamer ships), so they do not "compete" the way the removed `defineAgentEndpoint` path once did. Pick
 * `@Expose` when the agent is built separately and you want the exposure visible in a controller; pick
 * `@Agent` when the class itself is the agent.
 *
 * Convention over configuration:
 *   @Agent()                    → name + route inferred from class name
 *   @Agent({ model: '...' })   → name + route inferred, model explicit
 *   @Agent({ name, route, model }) → fully explicit
 *
 * @example
 * ```ts
 * // Convention: SupportAgent → name: 'support', route: '/api/agents/support'
 * @Agent()
 * class SupportAgent { ... }
 *
 * // Partial: infer name + route, set model
 * @Agent({ model: 'claude-sonnet-4-5-20250929' })
 * class SupportAgent { ... }
 *
 * // Explicit: full control
 * @Agent({ name: 'support-agent', route: '/api/agents/support', model: '...' })
 * class SupportAgent { ... }
 * ```
 */
import { setMeta, getMeta, AGENT_CONFIG } from '../metadata/index.js'
import type { AgentOptions } from '../types.js'

/**
 * Infer agent name and route from class name (Rails-style convention).
 *
 * SupportAgent     → name: 'support',      route: '/api/agents/support'
 * ResearchAgent    → name: 'research',     route: '/api/agents/research'
 * CodeReviewAgent  → name: 'code-review',  route: '/api/agents/code-review'
 */
function inferAgentMeta(className: string): { name: string; route: string } {
  const stripped = className.replace(/Agent$/, '')
  const kebab = stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
  return { name: kebab, route: `/api/agents/${kebab}` }
}

export function Agent(options?: Partial<AgentOptions>): ClassDecorator {
  return (target: Function) => {
    const inferred = inferAgentMeta(target.name)
    setMeta(AGENT_CONFIG, target, {
      stream: true,
      name: inferred.name,
      route: inferred.route,
      ...options, // explicit values override inferred
    })
  }
}

export function getAgentConfig(target: Function): AgentOptions | undefined {
  return getMeta<AgentOptions>(AGENT_CONFIG, target)
}
