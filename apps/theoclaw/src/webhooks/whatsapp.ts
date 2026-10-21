import {
  ConfigurationError,
  parseWebhookPayload,
  verifyWebhookSignature,
  verifyWebhookSubscription,
} from '@theokit/gateway-whatsapp'
import type { WhatsAppAdapter } from '@theokit/gateway-whatsapp'

import { statusFor } from './status.js'
import type { DeliverOutcome } from './status.js'

/** The two methods of the started WhatsApp adapter the route uses (D4). */
export type DeliverableWhatsAppAdapter = Pick<WhatsAppAdapter, 'toDeliverableEvents' | 'deliver'>

export interface WhatsAppRouteOptions {
  readonly appSecret: string
  readonly verifyToken: string
  readonly adapter: DeliverableWhatsAppAdapter
  /** Where a conversion the adapter refused is written; the output mask covers it. */
  readonly write: (line: string) => void
}

function answer(status: number): Response {
  return new Response(null, { status })
}

/** Meta's subscription check: the challenge back as text, or 401 for a wrong token. */
function answerSubscription(request: Request, verifyToken: string): Response {
  const query = Object.fromEntries(new URL(request.url).searchParams)
  const challenge = verifyWebhookSubscription(query, verifyToken)
  return challenge === null
    ? answer(401)
    : new Response(challenge, { status: 200, headers: { 'content-type': 'text/plain' } })
}

/** The Meta envelope of a raw body, or null when the body is not JSON or not an envelope. */
function envelopeOf(raw: Buffer): ReturnType<typeof parseWebhookPayload> {
  let json: unknown
  try {
    json = JSON.parse(raw.toString('utf8'))
  } catch {
    // Not JSON: the caller answers 400, which is the whole handling a malformed body gets.
    return null
  }
  return parseWebhookPayload(json)
}

/**
 * The WhatsApp Cloud webhook (FR-006). GET answers Meta's subscription check. POST verifies
 * `x-hub-signature-256` over the raw body (401), parses the envelope (400), and delivers every
 * event the started adapter's own `toDeliverableEvents` returns, which applies the package's
 * sender rules (REQ-7): an envelope of status receipts or refused senders yields none and answers
 * 200. A conversion the adapter refuses (no phone number id, EC-8) is a wrong build, not the
 * sender's doing: written, and answered 500 with nothing delivered.
 */
export function createWhatsAppRoute(options: WhatsAppRouteOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method === 'GET') return answerSubscription(request, options.verifyToken)
    // The signature is over the bytes Meta sent, so it is checked before any decoding.
    const raw = Buffer.from(await request.arrayBuffer())
    if (!verifyWebhookSignature(raw, request.headers.get('x-hub-signature-256') ?? undefined, options.appSecret)) {
      return answer(401)
    }
    const envelope = envelopeOf(raw)
    if (envelope === null) return answer(400)
    let events: ReturnType<DeliverableWhatsAppAdapter['toDeliverableEvents']>
    try {
      events = options.adapter.toDeliverableEvents(envelope)
    } catch (error) {
      // Only the wrong build EC-8 names is answered here; anything else is the router's to write.
      if (!(error instanceof ConfigurationError) || error.code !== 'missing_phone_number_id') throw error
      options.write(`whatsapp: webhook conversion refused (${error.code}): ${error.message}`)
      return answer(500)
    }
    const outcomes: DeliverOutcome[] = []
    for (const event of events) outcomes.push(await options.adapter.deliver(event))
    return answer(statusFor(outcomes))
  }
}
