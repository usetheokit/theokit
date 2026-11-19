import { type SdkMessage, type SdkTimelineEvent } from '@theokit/agents/bridge'

import type { SdkMessageLike, TurnTimelineEvent } from '../agent-port.js'

/**
 * The bridge reads a message through an index signature the SDK's message interfaces do not declare,
 * so the SDK's message is not assignable to it. A copy is; no cast stands in for it.
 */
export function toBridgeMessage(message: SdkMessageLike): SdkMessage {
  return { ...message }
}

/** The run's timeline event in the bridge's shape, its message converted the same way. */
export function toBridgeTimelineEvent(event: TurnTimelineEvent): SdkTimelineEvent {
  const { message, ...rest } = event
  return message === undefined ? rest : { ...rest, message: toBridgeMessage(message) }
}
