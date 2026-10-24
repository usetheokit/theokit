import type { BasePlatformAdapter } from '@theokit/gateway'
import { lineEventToMessageEvent, verifyLineSignature } from '@theokit/gateway-line'
import type { LineWebhookEvent } from '@theokit/gateway-line'

import { statusFor } from './status.js'
import type { DeliverOutcome } from './status.js'

export interface LineRouteOptions {
  readonly channelSecret: string
  /** The adapter inside the started runner; the router answers 503 before this route while it is not. */
  readonly adapter: Pick<BasePlatformAdapter, 'deliver'>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * An event the package's conversion can read without throwing: an object whose `source` and
 * `message`, when present, are objects too (a null there throws inside `lineEventToMessageEvent`).
 */
function isReadableEvent(event: unknown): event is LineWebhookEvent {
  return (
    isObject(event) &&
    (event.source === undefined || isObject(event.source)) &&
    (event.message === undefined || isObject(event.message))
  )
}

/** The events of a LINE webhook body, or undefined when it is not one. */
function eventsOf(raw: string): readonly LineWebhookEvent[] | undefined {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    // Not JSON: the caller answers 400, which is the whole handling a malformed body gets.
    return undefined
  }
  const events = isObject(body) ? body.events : undefined
  return Array.isArray(events) && events.every(isReadableEvent) ? events : undefined
}

/**
 * The LINE webhook (FR-005): signature first, over the raw body, then the events, delivered one
 * by one; the answer is the worst outcome (FR-009). Replies leave through the push API, so no
 * reply token is kept.
 *
 * Two things this route does not do, on purpose. `deliver()` applies no mention guard, so a group
 * message reaches the agent without a mention (alignment brief, Constraints). And a batch is
 * delivered event by event: when one fails and LINE redelivers the batch, the events that already
 * went through run again, since the route cannot ask the runner beforehand whether it would take
 * them.
 */
export function createLineRoute(options: LineRouteOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const raw = await request.text()
    if (!verifyLineSignature(options.channelSecret, raw, request.headers.get('x-line-signature') ?? undefined)) {
      return new Response(null, { status: 401 })
    }
    const events = eventsOf(raw)
    if (events === undefined) return new Response(null, { status: 400 })
    const outcomes: DeliverOutcome[] = []
    for (const event of events) {
      const message = lineEventToMessageEvent(event)
      if (message !== undefined) outcomes.push(await options.adapter.deliver(message))
    }
    return new Response(null, { status: statusFor(outcomes) })
  }
}
