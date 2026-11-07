import type { GatewayHook } from '@theokit/gateway'

import { createOwnerPolicyHook } from './authorization/owner-policy-hook.js'
import type { PairingStore } from './authorization/pairing-store.js'
import { type AuthorizationPolicy, isPolicyOwner } from './authorization/policy.js'
import { createHelpHook } from './channels/help-hook.js'
import { createGroupActivationHook } from './channels/group-activation-hook.js'

export interface ChannelHookOptions {
  readonly policy: AuthorizationPolicy
  /** The pairing store; absent without a state directory, where the hook runs without one. */
  readonly pairing?: PairingStore
  /** The masked write the hooks report through. */
  readonly write: (line: string) => void
  /** The `/usage` hook (B-400 FR-005), run third. */
  readonly usage?: GatewayHook
}

/**
 * The gateway hooks the channel loop runs, in order. The owner policy is first, so every later
 * hook sees only owners and paired senders (FR-007); `/usage` is answered last.
 */
export function channelHooks(options: ChannelHookOptions): readonly GatewayHook[] {
  const { policy, pairing, write } = options
  const ownerPolicy = createOwnerPolicyHook({ policy, ...(pairing === undefined ? {} : { pairing }), write })
  const groupActivation = createGroupActivationHook({
    isOwner: (platform, senderId) => isPolicyOwner(policy, platform, senderId),
    mode: policy.groupActivation,
    write,
  })
  const help = createHelpHook()
  return options.usage === undefined ? [ownerPolicy, groupActivation, help] : [ownerPolicy, groupActivation, options.usage, help]
}
