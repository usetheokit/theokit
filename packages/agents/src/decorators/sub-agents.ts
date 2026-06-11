/**
 * @SubAgents() — declares child agents that a parent agent can handoff to.
 *
 * Compiles to the SDK's `AgentOptions.agents` map. The parent agent
 * can delegate work to sub-agents via the built-in Agent tool.
 *
 * @example
 * ```ts
 * @Agent({ name: 'orchestrator', route: '/api/agents/orchestrator' })
 * @SubAgents([ResearchAgent, CoderAgent, ReviewerAgent])
 * class OrchestratorAgent {
 *   @MainLoop({ strategy: 'plan-act-reflect' })
 *   async run(ctx: AgentContext) { ... }
 * }
 * ```
 *
 * Each referenced class MUST be decorated with @Agent().
 * The compiler reads their metadata to build the SDK agents map.
 */
import { setMeta, getMeta } from '../metadata/index.js'

import { getAgentConfig } from './agent.js'

const SUB_AGENTS = Symbol.for('theokit:agents:sub-agents')

export function SubAgents(agentClasses: Function[]): ClassDecorator {
  return (target: Function) => {
    // Validate at decoration time: all classes must have @Agent
    for (const cls of agentClasses) {
      const config = getAgentConfig(cls)
      if (!config) {
        throw new Error(
          `[@theokit/agents] @SubAgents on ${target.name}: class ${cls.name} is missing @Agent() decorator.`,
        )
      }
    }
    setMeta(SUB_AGENTS, target, agentClasses)
  }
}

export function getSubAgents(target: Function): Function[] {
  return getMeta<Function[]>(SUB_AGENTS, target) ?? []
}
