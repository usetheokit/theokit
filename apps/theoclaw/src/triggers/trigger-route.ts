import type { BasePlatformAdapter, PlatformName } from '@theokit/gateway'
import { fromSdkMessage } from '@theokit/presenter'
import { github } from 'theokit/server/webhook'
import type { VerifyFn } from 'theokit/server/webhook'

import type { TurnAgent } from '../agent-port.js'
import { deliverText } from '../channels/deliver.js'
import { describeError } from '../control-plane/errors.js'
import type { WebhookRoute } from '../webhooks/router.js'
import type { TriggerSettings } from './trigger-settings.js'

/** The header a sender sets to have a retried delivery answered 200 instead of run twice (FR-004). */
export const DELIVERY_HEADER = 'x-theoclaw-delivery'

/** The longest delivery id kept; a longer one answers 400, so the cache cannot grow by its ids (EC-3). */
const MAX_DELIVERY_ID_LENGTH = 256

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
}

function answer(status: number): Response {
  return new Response(null, { status })
}

/** The delivery ids a trigger accepted, the oldest dropped past the cap. */
function deliveryCache(): { has(id: string): boolean; add(id: string): void } {
  const seen = new Set<string>()
  const order: string[] = []
  return {
    has: (id) => seen.has(id),
    add: (id) => {
      seen.add(id)
      order.push(id)
      if (order.length > REMEMBERED_DELIVERIES) seen.delete(order.shift() as string)
    },
  }
}

/** The prompt of one delivery: the trigger's instructions, if any, then the body as delivered. */
function promptOf(trigger: TriggerSettings, body: string): string {
  const parts = [trigger.instructions, `The following was delivered by trigger ${trigger.name}:`, body]
  return parts.filter((part): part is string => part !== undefined).join('\n\n')
}

/** The run's text and the error code a stream frame reported, if any. */
async function runText(agent: TurnAgent, prompt: string): Promise<{ readonly text: string; readonly failure?: string }> {
  const run = await agent.send(prompt)
  let text = ''
  let streamError: string | undefined
  for await (const frame of run.stream()) {
    for (const output of fromSdkMessage({ ...frame })) {
      if (output.type === 'text') text += output.text
      if (output.type === 'error') streamError = output.code
    }
  }
  const result = await run.wait()
  if (result.status === 'error' || streamError !== undefined) return { text, failure: result.error?.code ?? streamError ?? 'no error code' }
  return { text }
}

/**
 * The route of one trigger (D1, D2). A delivery whose signature fails answers 401 and nothing about
 * its body is written. A reply platform that has not started answers 503, and the id is not kept,
 * so the sender's retry runs. A delivery id seen before answers 200. Otherwise the id is kept
 * before anything else is awaited, the route answers 202, and one run starts without being awaited;
 * its answer is sent once to the trigger's reply channel.
 */
export function createTriggerRoute(options: TriggerRouteOptions): WebhookRoute {
  const { trigger, adapterFor, withAgent, write } = options
  const verify = options.verify ?? github({ secret: trigger.secret })
  const seen = deliveryCache()
  const { platform, channelId } = trigger.replyTo

  const run = async (body: string): Promise<void> => {
    const outcome = await withAgent((agent) => runText(agent, promptOf(trigger, body)))
    if (outcome.failure !== undefined) {
      write(`trigger ${trigger.name}: run failed (${outcome.failure})`)
      return
    }
    const adapter = adapterFor(platform)
    const failure = adapter === undefined ? 'not started' : await deliverText(adapter, platform, channelId, outcome.text)
    if (failure !== undefined) write(`trigger ${trigger.name}: the reply was not delivered (${failure})`)
  }

  return {
    methods: ['POST'],
    handle: async (request) => {
      if (!(await verify(request.clone())).ok) return answer(401)
      const id = (request.headers.get(DELIVERY_HEADER) ?? '').trim()
      if (id.length > MAX_DELIVERY_ID_LENGTH) return answer(400)
      if (adapterFor(platform) === undefined) return answer(503)
      if (id !== '' && seen.has(id)) return answer(200)
      if (id !== '') seen.add(id)
      const body = await request.text()
      void run(body).catch((error: unknown) => write(`trigger ${trigger.name}: run failed (${describeError(error)})`))
      return answer(202)
    },
  }
}
