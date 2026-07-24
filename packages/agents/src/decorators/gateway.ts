/**
 * @Gateway() — declares which platform adapters an agent supports.
 *
 * Stores gateway configuration metadata on the agent class.
 * The GatewayRunner reads this to auto-wire adapters without manual plumbing.
 *
 * @example
 * ```ts
 * @Agent({ name: 'support', route: '/api/agents/support' })
 * @Gateway({
 *   platforms: ['telegram', 'discord', 'slack'],
 *   sessionStrategy: 'per-user',
 * })
 * @UseGuards(AuthGuard)
 * class SupportAgent {
 *   @MainLoop()
 *   async run(ctx: AgentContext) { ... }
 * }
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'
import type { GatewayOptions, SessionStrategy } from '../types.js'

const GATEWAY_CONFIG = Symbol.for('theokit:agents:gateway')

export type { PlatformName } from '../types.js'

export type { SessionStrategy } from '../types.js'

export type { GatewayOptions } from '../types.js'

export function Gateway(options: GatewayOptions): ClassDecorator {
  return (target: Function) => {
    setMeta(GATEWAY_CONFIG, target, { typing: true, sessionStrategy: 'per-user', ...options })
  }
}

export function getGatewayConfig(target: Function): GatewayOptions | undefined {
  return getMeta<GatewayOptions>(GATEWAY_CONFIG, target)
}

/**
 * Resolve a stable agentId from a platform event based on the session strategy.
 *
 * Mirrors @theokit/gateway SessionRouter.defaultStrategy() but is configurable
 * via the @Gateway decorator.
 */
export function resolveSessionId(
  strategy: SessionStrategy,
  platform: string,
  sender: { id: string },
  channel: { id: string; type: 'dm' | 'group' | 'thread'; topicId?: string },
): string {
  switch (strategy) {
    case 'per-user':
      return `${platform}-dm-${sender.id}`
    case 'per-channel':
      return `${platform}-grp-${channel.id}`
    case 'per-thread':
      return `${platform}-tpc-${channel.id}-${channel.topicId ?? 'main'}`
  }
}
