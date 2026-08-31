/**
 * server/webhook — Webhook primitives (Phase 0 + Phase 4, R0.5.10).
 *
 * T4.4 (architecture-cleanup) — sub-barrel entrypoint.
 */

export { timingSafeEqual } from './timing-safe-equal.js'
export { readRawBody, BodyTooLargeError, DEFAULT_MAX_BODY_BYTES } from './raw-body.js'
export type { RawBodyResult, ReadRawBodyOptions } from './raw-body.js'
export { defineWebhook, dispatchWebhook } from './define-webhook.js'
export type {
  DefineWebhookOptions,
  WebhookDefinition,
  WebhookContext,
  VerifyFn,
  VerifyResult,
} from './webhook-types.js'

// The signature validators `handleChannelWebhook` requires. They existed beside this file from the
// start and were never re-exported, so no consumer of the published package could supply the
// `validators` map the function demands — its own docblock shows `telegram({...})`, and `telegram`
// was unreachable. The framework's own tests import them by relative source path, which is exactly
// why nothing caught it (theokit-gateways B-011).
export {
  discord,
  github,
  line,
  slack,
  stripe,
  telegram,
  whatsapp,
  whatsappSubscribe,
} from './providers/index.js'
export type {
  DiscordWebhookOptions,
  GitHubWebhookOptions,
  LineWebhookOptions,
  SlackWebhookOptions,
  StripeWebhookOptions,
  TelegramWebhookOptions,
  WhatsAppWebhookOptions,
  WhatsAppSubscribeOptions,
  // The handshake seam's types, exported for the same reason the validators are: an app that
  // implements `subscribe` for a platform this package does not ship needs to name the shape.
  SubscribeFn,
  SubscribeResult,
} from './providers/index.js'
