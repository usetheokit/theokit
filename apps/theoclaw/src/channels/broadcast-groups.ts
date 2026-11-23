import type { BasePlatformAdapter, MessageEvent, PlatformName, SendResult } from '@theokit/gateway'
import { createBroadcastGroups } from '@theokit/gateway-agent'
import type { BroadcastGroups } from '@theokit/gateway-agent'

import { maskSecrets } from '@theokit/gateway'

/**
 * Broadcast groups (OC-21, FR-008): channels on several platforms that share one agent thread. The
 * member list is typed here, not imported from the authorization policy, which has the same shape:
 * `src/channels/` never imports `src/authorization/` (`.dependency-cruiser.cjs`).
 */
export interface BroadcastGroupConfig {
  readonly name: string
  readonly members: ReadonlyArray<{ readonly platform: string; readonly channelId: string }>
}

/** Broadcast groups and how their other members are reached (OC-21). */
export interface BroadcastOptions {
  readonly groups: readonly BroadcastGroupConfig[]
  /** The started adapter of a platform, or undefined while it is not started. */
  readonly adapterFor: (platform: string) => BasePlatformAdapter | undefined
  /** Where a member that could not be reached is reported; never with a token or a sender id. */
  readonly write: (line: string) => void
  /** Values no recorded or forwarded text may carry. Default: none. */
  readonly secrets?: readonly string[]
}

/** At most 10 exchanges (20 turns) and 16 384 characters of thread (NFR-003). */
const MAX_EXCHANGES = 10
const MAX_CHARACTERS = 16_384

/**
 * The package's broadcast groups over the app's configuration: members are reached through the
 * adapter their platform has when the answer is sent (it starts after this is built), a member that
 * cannot be reached is written with the group's name and platform only, and the message that joins
 * the thread is masked as the answer is.
 */
export function createMaskedBroadcast(options: BroadcastOptions): BroadcastGroups {
  const secrets = options.secrets ?? []
  const report = (group: string, platform: string, code: string): void =>
    options.write(`broadcast group ${group}: ${platform}: the answer was not delivered (${code})`)
  const groups = createBroadcastGroups(
    options.groups.map((config) => ({
      id: config.name,
      maxTurns: MAX_EXCHANGES,
      maxChars: MAX_CHARACTERS,
      members: config.members.map(({ platform, channelId }) => {
        // Resolved at send time. A refusal or a throw is written here, because the package's
        // delivery keeps only a code it does not return.
        const forwarding = {
          platform: platform as PlatformName,
          sendMessage: async (message: Parameters<BasePlatformAdapter['sendMessage']>[0]): Promise<SendResult> => {
            const adapter = options.adapterFor(platform)
            if (adapter === undefined) {
              report(config.name, platform, 'not started')
              return { ok: false } as SendResult
            }
            let result: SendResult
            try {
              result = await adapter.sendMessage(message)
            } catch (error) {
              report(config.name, platform, error instanceof Error ? error.name : 'unknown error')
              throw error
            }
            if (!result.ok) report(config.name, platform, result.error?.code ?? 'send failed')
            return result
          },
        } as BasePlatformAdapter
        return { adapter: forwarding, channelId, channelType: 'group' as const }
      }),
    })),
  )
  return {
    ...groups,
    onTurnEnd: (event: MessageEvent, outcome) => groups.onTurnEnd({ ...event, text: maskSecrets(event.text, secrets) }, outcome),
  }
}
