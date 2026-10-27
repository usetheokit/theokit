import type { BasePlatformAdapter } from '@theokit/gateway'
import { parseInbound, smsWebhookVerifier } from '@theokit/gateway-sms'
import type { SMSAdapterOptions } from '@theokit/gateway-sms'

import { statusFor } from './status.js'

/** What the route needs of the started SMS adapter: verify a signature, deliver an event. */
export type SmsRouteAdapter = Parameters<typeof smsWebhookVerifier>[0] & Pick<BasePlatformAdapter, 'deliver'>

export interface SmsRouteOptions {
  readonly adapter: SmsRouteAdapter
  /** The adapter's own options: the backend that parses the body, and the URL the provider signed. */
  readonly options: SMSAdapterOptions
}

/**
 * The SMS webhook (FR-007): the package's verifier reads the body, so it checks a clone and the
 * route parses the original. Twilio posts form-encoded bodies, which is why this does not go
 * through `handleChannelWebhook` (D2).
 */
export function createSmsRoute({ adapter, options }: SmsRouteOptions): (request: Request) => Promise<Response> {
  const verify = smsWebhookVerifier(adapter, { publicUrl: options.publicUrl })
  return async (request) => {
    const verdict = await verify(request.clone())
    if (!verdict.ok) return new Response(null, { status: 401 })
    const rawBody = await request.text()
    const headers = Object.fromEntries(request.headers)
    const event = parseInbound(options, { headers, rawBody, url: options.publicUrl })
    if (event === null) return new Response(null, { status: 400 })
    return new Response(null, { status: statusFor([await adapter.deliver(event)]) })
  }
}
