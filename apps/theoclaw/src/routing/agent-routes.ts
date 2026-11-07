/**
 * Routing between agents (OC-81, B-395): bindings per channel, account and peer to isolated
 * agents, each with its own workspace. The most specific matching rule wins (peer, then account,
 * then channel/platform); ties go to the earlier rule. No rule matches: the default agent.
 */
export interface AgentRoute {
  /** The agent that answers. */
  readonly agent: string
  readonly platform?: string
  readonly account?: string
  readonly peer?: string
}

export interface AgentProfile {
  readonly id: string
  /** The agent's own workspace directory. */
  readonly workspace: string
}

export interface RoutingConfig {
  readonly defaultAgent: string
  readonly agents: readonly AgentProfile[]
  readonly routes: readonly AgentRoute[]
}

export interface RoutedMessage {
  readonly platform: string
  readonly account?: string
  readonly peer?: string
}

export interface AgentRouter {
  /** The profile of the agent that must answer `message`. */
  route(message: RoutedMessage): AgentProfile
}

function specificity(rule: AgentRoute, message: RoutedMessage): number {
  let score = 0
  if (rule.platform !== undefined) {
    if (rule.platform !== message.platform) return -1
    score += 1
  }
  if (rule.account !== undefined) {
    if (rule.account !== message.account) return -1
    score += 2
  }
  if (rule.peer !== undefined) {
    if (rule.peer !== message.peer) return -1
    score += 4
  }
  return score
}

/** Validate the config once: every route and the default must name a configured agent. */
export function createAgentRouter(config: RoutingConfig): AgentRouter {
  const profiles = new Map(config.agents.map((profile) => [profile.id, profile]))
  const lookup = (id: string): AgentProfile => {
    const profile = profiles.get(id)
    if (profile === undefined) throw new Error(`routing names an unconfigured agent: ${id}`)
    return profile
  }
  const fallback = lookup(config.defaultAgent)
  for (const rule of config.routes) lookup(rule.agent)
  return {
    route(message) {
      let best: AgentRoute | undefined
      let bestScore = 0
      for (const rule of config.routes) {
        const score = specificity(rule, message)
        if (score > bestScore) {
          best = rule
          bestScore = score
        }
      }
      return best === undefined ? fallback : lookup(best.agent)
    },
  }
}
