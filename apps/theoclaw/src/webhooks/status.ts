import type { BasePlatformAdapter } from '@theokit/gateway'

/** What one `deliver()` call resolved to, as `@theokit/gateway` declares it. */
export type DeliverOutcome = Awaited<ReturnType<BasePlatformAdapter['deliver']>>

/** The statuses a webhook answers once its events were delivered. */
export type WebhookStatus = 200 | 500 | 503

/** Least to most severe: a batch answers the latest of these that any of its outcomes maps to. */
const BY_SEVERITY: readonly WebhookStatus[] = [200, 500, 503]

/**
 * The status a webhook answers for a batch of deliveries: the worst outcome wins (FR-009).
 *
 * `no_handler` means nothing received the message, so the provider must retry; answering 200
 * would make it drop a message nobody read. An empty batch was handled (LINE's verification
 * ping carries no event).
 */
export function statusFor(outcomes: readonly DeliverOutcome[]): WebhookStatus {
  const worst = Math.max(0, ...outcomes.map((outcome) => BY_SEVERITY.indexOf(statusOf(outcome))))
  return BY_SEVERITY[worst] ?? 200
}

/**
 * One outcome's status. The `never` default makes an outcome a later `@theokit/gateway` adds a
 * type error here; at runtime it throws rather than answer 200 for something unmapped.
 */
function statusOf(outcome: DeliverOutcome): WebhookStatus {
  switch (outcome) {
    case 'ok':
      return 200
    case 'handler_threw':
      return 500
    case 'no_handler':
      return 503
    default: {
      const unmapped: never = outcome
      throw new Error(`deliver() returned an outcome this app does not map: ${String(unmapped)}`)
    }
  }
}
