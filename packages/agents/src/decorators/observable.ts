/**
 * @Observable() — exposes agent internal state as a real-time stream.
 *
 * Clients subscribe to named observables to monitor agent execution in real-time:
 * token usage, cost, iteration progress, pending approvals, retrieved facts.
 *
 * Inspired by Liveblocks' Presence pattern and tRPC subscriptions. The agent
 * pushes state updates via SSE alongside response events — clients are never
 * "blind" during long-running agent operations.
 *
 * @example
 * ```ts
 * @Agent({ name: 'research', route: '/research' })
 * class ResearchAgent {
 *   @MainLoop()
 *   async run() {}
 *
 *   @Observable('metrics')
 *   getMetrics(ctx: AgentContext): AgentMetrics {
 *     return {
 *       tokensUsed: ctx.tokenCount,
 *       costUsd: ctx.costUsd,
 *       iteration: ctx.iteration,
 *       pendingApprovals: ctx.pendingApprovals.length,
 *     }
 *   }
 * }
 *
 * // SSE emits: { type: 'state_update', channel: 'metrics', data: {...} }
 * // Client: eventSource.addEventListener('state_update', handler)
 * ```
 */
import { setMeta, getMeta } from '../metadata/index.js'

const OBSERVABLE_CONFIG = Symbol.for('theokit:agents:observable')

export interface ObservableEntry {
  channel: string
  propertyKey: string | symbol
}

export function Observable(channel: string): MethodDecorator {
  return (target: object, propertyKey: string | symbol) => {
    const actualTarget = target.constructor
    const existing = getMeta<ObservableEntry[]>(OBSERVABLE_CONFIG, actualTarget) ?? []
    setMeta(OBSERVABLE_CONFIG, actualTarget, [...existing, { channel, propertyKey }])
  }
}

export function getObservables(target: Function): ObservableEntry[] {
  return getMeta<ObservableEntry[]>(OBSERVABLE_CONFIG, target) ?? []
}

export function getObservableByChannel(target: Function, channel: string): ObservableEntry | undefined {
  return getObservables(target).find((o) => o.channel === channel)
}
