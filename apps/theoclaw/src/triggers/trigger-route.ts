import type { BasePlatformAdapter, PlatformName } from '@theokit/gateway'
import { createTrigger } from '@theokit/gateway-agent'
import type { AgentLease } from '@theokit/gateway-agent'
import { github } from 'theokit/server/webhook'
import type { VerifyFn } from 'theokit/server/webhook'

import type { TurnAgent } from '../agent-port.js'
import type { WebhookRoute } from '../webhooks/router.js'
import type { TriggerSettings } from './trigger-settings.js'

/** The header a sender sets to have a retried delivery answered 200 instead of run twice (FR-004). */
export const DELIVERY_HEADER = 'x-theoclaw-delivery'

/** How many delivery ids one trigger remembers; the oldest is forgotten first. */
const REMEMBERED_DELIVERIES = 1000

export interface TriggerRouteOptions {
  readonly trigger: TriggerSettings
  /** Defaults to GitHub's `x-hub-signature-256` HMAC over the raw body, keyed by the trigger's secret. */
  readonly verify?: VerifyFn
  /** The started adapter of a platform, or undefined while it has not started. */
  readonly adapterFor: (platform: PlatformName) => BasePlatformAdapter | undefined
  /** One request boundary per run: the agent is fresh and disposed when the run ends (D2). */
  readonly withAgent: <R>(work: (agent: TurnAgent) => R | Promise<R>) => Promise<R>
  /** Where a failed run or an undelivered reply is written; the process output mask covers it. */
  readonly write: (line: string) => void
  /** Values no reply may carry (`processSecrets`, B-398 FR-006): masked before the reply is sent. Default: none. */
  readonly secrets?: readonly string[]
}

/**
 * The route of one trigger (D1, D2). A delivery whose signature fails answers 401 and nothing about
 * its body is written. A reply platform that has not started answers 503, and the id is not kept,
 * so the sender's retry runs. A delivery id seen before answers 200. Otherwise the id is kept
 * before anything else is awaited, the route answers 202, and one run starts without being awaited;
 * its answer is sent once to the trigger's reply channel.
 */
export function createTriggerRoute(options: TriggerRouteOptions): WebhookRoute {
  const { trigger, adapterFor, withAgent } = options
  const { platform, channelId } = trigger.replyTo
  const verify = options.verify ?? github({ secret: trigger.secret })
  const delivery = createTrigger({
    name: trigger.name,
    verify: async (request) => verify(request),
    deliverTo: () => ({ adapter: adapterFor(platform), channelId }),
    // The agent is fresh per run and the request boundary stays open until the run releases it.
    agent: () =>
      new Promise<AgentLease>((resolve, reject) => {
        withAgent(
          (agent) =>
            new Promise<void>((released) => {
              resolve({ agent, release: released })
            }),
        ).catch(reject)
      }),
    instructions: [trigger.instructions, `The following was delivered by trigger ${trigger.name}:`].filter((part): part is string => part !== undefined).join('\n\n'),
    dedupeHeader: DELIVERY_HEADER,
    rememberDeliveries: REMEMBERED_DELIVERIES,
    secrets: options.secrets ?? [],
    write: options.write,
  })
  return { methods: ['POST'], handle: (request) => delivery.handle(request) }
}

/** One route per trigger, keyed by name, sharing the reply adapters, the agent boundary and the writer. */
export function triggerRoutes(
  triggers: readonly TriggerSettings[],
  shared: Omit<TriggerRouteOptions, 'trigger' | 'verify'>,
): ReadonlyMap<string, WebhookRoute> {
  return new Map(triggers.map((trigger) => [trigger.name, createTriggerRoute({ ...shared, trigger })]))
}
