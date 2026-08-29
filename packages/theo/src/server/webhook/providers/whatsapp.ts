/**
 * WhatsApp Cloud API webhook — signature verification and the subscribe handshake (#556).
 *
 * Two halves, because Meta's endpoints have two lifecycles:
 *
 *   1. {@link whatsapp} verifies a DELIVERY. `X-Hub-Signature-256: sha256=<hex>` is HMAC-SHA256 of
 *      the app secret over the raw body — the same scheme GitHub uses, so it goes through the same
 *      implementation rather than a second copy of the crypto.
 *   2. {@link whatsappSubscribe} answers the SUBSCRIBE handshake. Before Meta delivers anything it
 *      calls the endpoint with `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` and
 *      requires the challenge echoed back as `text/plain`. Until this existed the channel seam
 *      could not serve WhatsApp even with a validator in place: an app had to add a route of its
 *      own for the GET, which is the thing the seam is for.
 *
 * The handshake is Meta's, not WhatsApp's — Instagram and Messenger use the identical query shape.
 * It is named for the platform anyway, because that is the platform this framework ships a gateway
 * for, and a one-line alias is the honest way to add the next one.
 *
 * @see https://developers.facebook.com/docs/graph-api/webhooks/getting-started
 */
import { timingSafeEqual } from '../timing-safe-equal.js'
import type { VerifyFn } from '../webhook-types.js'

import { verifyHubSignature256 } from './hub-signature-256.js'

export interface WhatsAppWebhookOptions {
  /**
   * The Meta app secret (App Dashboard → Settings → Basic), NOT the access token.
   *
   * Pass an array during a rotation: both verify while the overlap lasts.
   */
  appSecret: string | readonly string[]
}

/**
 * Verify a WhatsApp Cloud API delivery.
 *
 * The signature covers the EXACT bytes Meta sent, so this must run against a request whose body has
 * not been parsed and re-serialized — `handleChannelWebhook` hands it a `clone()` for that reason.
 * Hashing a round-tripped body compares different bytes and rejects correct requests, which is the
 * failure mode #534 documents for controllers.
 */
export function whatsapp(opts: WhatsAppWebhookOptions): VerifyFn {
  return verifyHubSignature256(
    Array.isArray(opts.appSecret) ? opts.appSecret : [opts.appSecret as string],
  )
}

/** The outcome of a subscribe handshake: the challenge to echo, or why it was refused. */
export type SubscribeResult = { ok: true; challenge: string } | { ok: false; reason: string }

/**
 * Answers the GET a platform sends to verify an endpoint before subscribing it.
 *
 * Sync-or-async like {@link VerifyFn}, so an implementation that has to look the token up
 * (per-tenant, a secret store) is not forced into a different shape than one that holds it.
 */
export type SubscribeFn = (req: Request) => Promise<SubscribeResult> | SubscribeResult

export interface WhatsAppSubscribeOptions {
  /**
   * The verify token configured on the Meta app when the webhook URL was registered. It is a shared
   * secret of the caller's choosing — Meta echoes it back, and comparing it is the ONLY thing
   * standing between an arbitrary caller and a subscription on this endpoint.
   */
  verifyToken: string
}

export function whatsappSubscribe(opts: WhatsAppSubscribeOptions): SubscribeFn {
  const encoder = new TextEncoder()
  const expected = encoder.encode(opts.verifyToken)

  return (req: Request): SubscribeResult => {
    const params = new URL(req.url).searchParams
    if (params.get('hub.mode') !== 'subscribe') {
      return { ok: false, reason: `hub.mode must be 'subscribe'` }
    }

    // `presented` rather than `token`: the pair `presented`/`expected` says which side came from
    // the caller, which is the distinction the comparison below turns on.
    const presented = params.get('hub.verify_token')
    if (presented === null) return { ok: false, reason: 'missing hub.verify_token' }

    // Constant-time, and length-checked first: `timingSafeEqual` refuses mismatched lengths, and
    // the length of a token is not a secret worth a branch.
    const got = encoder.encode(presented)
    if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
      return { ok: false, reason: 'hub.verify_token mismatch' }
    }

    const challenge = params.get('hub.challenge')
    // A handshake with a valid token and nothing to echo cannot be completed. Answering 200 with an
    // empty body would leave Meta reporting a failed verification against an endpoint that reported
    // success, so the refusal says which parameter was absent.
    if (challenge === null || challenge.length === 0) {
      return { ok: false, reason: 'missing hub.challenge' }
    }

    return { ok: true, challenge }
  }
}
