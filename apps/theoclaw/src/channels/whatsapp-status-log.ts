import type { ChannelDescriptor } from '@theokit/gateway'

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

/** A phone number reduced to its last four digits. */
function maskRecipient(id: unknown): string {
  const digits = String(id ?? '').replaceAll(/\D/g, '')
  return digits.length === 0 ? 'unknown' : `***${digits.slice(-4)}`
}

/**
 * Writes one line per `failed` delivery status in an envelope: Meta accepts a send with a 200 and
 * reports a refusal only here. `sent`, `delivered` and `read` write nothing.
 */
function logFailedStatuses(envelope: unknown, write: (line: string) => void): void {
  const entries = record(envelope)?.entry
  if (!Array.isArray(entries)) return
  for (const entry of entries) {
    const changes = record(entry)?.changes
    if (!Array.isArray(changes)) continue
    for (const change of changes) {
      const statuses = record(record(change)?.value)?.statuses
      if (!Array.isArray(statuses)) continue
      for (const raw of statuses) {
        const status = record(raw)
        if (status?.status !== 'failed') continue
        const errors = Array.isArray(status.errors) ? status.errors : [undefined]
        for (const error of errors) {
          const e = record(error)
          write(
            `whatsapp: delivery failed to ${maskRecipient(status.recipient_id)}: error ${String(e?.code ?? 'unknown')} ${String(e?.title ?? 'no title')}`,
          )
        }
      }
    }
  }
}

/**
 * The gateway's WhatsApp descriptor, with TheoClaw's one addition to its webhook: a failed delivery
 * status in a request whose signature checks is written, since Meta reports a refused send only
 * there. The answer is the descriptor's own; a request that does not verify writes nothing.
 */
export function withFailedStatusLog(descriptor: ChannelDescriptor, write: (line: string) => void): ChannelDescriptor {
  if (descriptor.transport !== 'webhook' || descriptor.webhook.handle === undefined) return descriptor
  const webhook = descriptor.webhook
  const handle = webhook.handle?.bind(webhook)
  if (handle === undefined) return descriptor
  return {
    ...descriptor,
    webhook: {
      ...webhook,
      async handle(adapter, request) {
        if (request.method?.toUpperCase() === 'POST' && (await webhook.verify(adapter, request))) {
          try {
            logFailedStatuses(JSON.parse(request.rawBody), write)
          } catch {
            // Not JSON: the descriptor answers 400, which is the whole handling a malformed body gets.
          }
        }
        return handle(adapter, request)
      },
    },
  }
}
