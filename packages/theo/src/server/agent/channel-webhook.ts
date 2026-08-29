/**
 * M27 (ADR-0041) — channel webhook routes: `POST /api/agents/<name>/channels/<platform>/webhook`.
 *
 * Auto-generates a per-platform inbound webhook endpoint that VALIDATES the platform signature
 * (reusing the existing webhook `VerifyFn` providers — Slack/Telegram/Discord — never a hand-rolled
 * scheme) and hands the parsed payload to an injected `onMessage` seam. The seam is where an app
 * wires the SDK gateway package (`@theokit/gateway-*`) that translates the payload into an agent
 * turn — TheoKit provides the route + signature gate, NOT the gateway's parsing (G2 / it does not
 * reimplement the gateway).
 */
import type { SubscribeFn } from '../webhook/providers/whatsapp.js'
import type { VerifyFn } from '../webhook/webhook-types.js'

const CHANNEL_PATH = /^\/api\/agents\/([^/]+)\/channels\/([^/]+)\/webhook$/

/** Parsed `{ agent, platform }` from a channel webhook path, or `null` when it doesn't match. */
export function parseChannelPath(urlPath: string): { agent: string; platform: string } | null {
  const match = CHANNEL_PATH.exec(urlPath)
  if (!match) return null
  return { agent: decodeURIComponent(match[1]), platform: decodeURIComponent(match[2]) }
}

/** True when `urlPath` targets a channel webhook (dev/prod routing branches on this). */
export function isChannelPath(urlPath: string): boolean {
  return CHANNEL_PATH.test(urlPath)
}

/** The inbound message handed to the app after signature validation passes. */
export interface ChannelMessage {
  agent: string
  platform: string
  /** The parsed JSON payload from the platform (the gateway translates this to an agent turn). */
  payload: unknown
}

export interface ChannelWebhookConfig {
  /** Per-platform signature validators (e.g. `{ slack: slack({...}), telegram: telegram({...}) }`). */
  validators: Record<string, VerifyFn>
  /**
   * Per-platform responders for the GET a platform sends to VERIFY the endpoint before it will
   * subscribe it (e.g. `{ whatsapp: whatsappSubscribe({ verifyToken }) }`).
   *
   * Separate from `validators` because it answers a different question at a different moment: a
   * validator authenticates a delivery, this authenticates a subscription request, and a platform
   * may need one, both, or neither. Per-platform rather than a bare `verifyToken` on this config,
   * because the query parameters are Meta's — shared with Instagram and Messenger, not universal —
   * and putting them here would bake one platform's shape into the seam (#556).
   *
   * A platform with no entry answers 405 on a GET: the route exists and does not do that.
   */
  subscribe?: Record<string, SubscribeFn>
  /** Handoff seam — wire the SDK gateway / agent here. Invoked only after signature validation. */
  onMessage: (message: ChannelMessage) => void | Promise<void>
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Answer the platform's endpoint-verification GET.
 *
 * `text/plain` and the bare challenge are not a style choice: Meta compares the response body to
 * the challenge it sent, so a JSON envelope fails verification while looking like a success.
 *
 * 405 rather than 404 for a platform with a validator and no responder — the platform IS
 * configured, and answering "not found" would send the reader looking for a validator that is
 * already there.
 */
async function handleSubscribe(
  request: Request,
  platform: string,
  config: ChannelWebhookConfig,
): Promise<Response> {
  const subscribe = config.subscribe?.[platform]
  if (subscribe === undefined) {
    return jsonError(
      405,
      'SUBSCRIBE_UNSUPPORTED',
      `Platform '${platform}' declared no subscribe handshake. Add one to \`subscribe\` (e.g. whatsappSubscribe({ verifyToken })).`,
    )
  }

  const result = await subscribe(request)
  if (!result.ok) {
    return jsonError(401, 'INVALID_SUBSCRIBE', `Subscribe handshake failed: ${result.reason}`)
  }

  return new Response(result.challenge, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * Handle one channel webhook request. Returns:
 *   404 UNKNOWN_PLATFORM — no validator configured for `<platform>`
 *   400 BAD_REQUEST      — path is not a channel webhook, or the body is not JSON
 *   401 INVALID_SIGNATURE — the platform signature check failed (negative case)
 *   405 SUBSCRIBE_UNSUPPORTED — a GET on a platform that declared no `subscribe` responder
 *   200 `<challenge>`    — subscribe handshake accepted (text/plain, per Meta's requirement)
 *   200 { ok: true }     — validated + handed to `onMessage`
 */
export async function handleChannelWebhook(
  request: Request,
  urlPath: string,
  config: ChannelWebhookConfig,
): Promise<Response> {
  const parsed = parseChannelPath(urlPath)
  if (parsed === null) {
    return jsonError(
      400,
      'BAD_REQUEST',
      'Path must be /api/agents/<name>/channels/<platform>/webhook.',
    )
  }
  if (!Object.hasOwn(config.validators, parsed.platform)) {
    return jsonError(
      404,
      'UNKNOWN_PLATFORM',
      `No validator configured for platform '${parsed.platform}'.`,
    )
  }

  // The handshake is answered BEFORE the delivery path, and only for GET. It carries no body and no
  // signature — the token in the query IS the credential — so running it through the validator
  // would reject every real verification attempt.
  if (request.method === 'GET') return await handleSubscribe(request, parsed.platform, config)

  const verify = config.validators[parsed.platform]

  // Validate the signature against a CLONE so the body stays readable for the payload parse.
  const verifyResult = await verify(request.clone())
  if (!verifyResult.ok) {
    return jsonError(
      401,
      'INVALID_SIGNATURE',
      `Signature validation failed: ${verifyResult.reason}`,
    )
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return jsonError(400, 'BAD_REQUEST', 'Request body must be JSON.')
  }

  await config.onMessage({ agent: parsed.agent, platform: parsed.platform, payload })
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
