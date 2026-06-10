/**
 * @Agent() — marks a class as an AI agent controller.
 *
 * Stores AgentOptions metadata. The compiler reads this to call
 * Agent.create() from @theokit/sdk at registration time.
 *
 * @example
 * ```ts
 * @Agent({ name: 'support-agent', route: '/api/agents/support', model: 'claude-sonnet-4-5-20250929' })
 * @UseGuards(AuthGuard)
 * class SupportAgent {
 *   @MainLoop()
 *   async run(ctx: AgentContext) { ... }
 * }
 * ```
 */
import { setMeta, getMeta, AGENT_CONFIG } from '../metadata/index.js'
import type { AgentOptions } from '../types.js'

export function Agent(options: AgentOptions): ClassDecorator {
  return (target: Function) => {
    setMeta(AGENT_CONFIG, target, { stream: true, ...options })
  }
}

export function getAgentConfig(target: Function): AgentOptions | undefined {
  return getMeta<AgentOptions>(AGENT_CONFIG, target)
}
