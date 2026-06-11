/**
 * @Agent() — marks a class as an AI agent controller.
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
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
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
