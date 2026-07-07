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
 * Handle one channel webhook request. Returns:
 *   404 UNKNOWN_PLATFORM — no validator configured for `<platform>`
 *   400 BAD_REQUEST      — path is not a channel webhook, or the body is not JSON
 *   401 INVALID_SIGNATURE — the platform signature check failed (negative case)
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
