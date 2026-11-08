import type { GatewayHook, MessageEvent } from '@theokit/gateway'

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
  /** The chat exec approval: `/approve`, `/deny`, `/elevated` (B-572), run after the owner policy. */
  readonly execApproval?: { readonly hook: GatewayHook; hasPending(event: MessageEvent): boolean }
}

/**
 * The gateway hooks the channel loop runs, in order. The owner policy is first, so every later
 * hook sees only owners and paired senders (FR-007); `/usage` is answered last.
 */
export function channelHooks(options: ChannelHookOptions): readonly GatewayHook[] {
  const { policy, pairing, write } = options
  const ownerPolicy = createOwnerPolicyHook({
    policy,
    ...(options.execApproval === undefined ? {} : { execPending: options.execApproval.hasPending }),
    ...(pairing === undefined ? {} : { pairing }),
    write,
  })
  const groupActivation = createGroupActivationHook({
    isOwner: (platform, senderId) => isPolicyOwner(policy, platform, senderId),
    mode: policy.groupActivation,
    write,
  })
  const help = createHelpHook()
  const exec = options.execApproval === undefined ? [] : [options.execApproval.hook]
  return [
    ownerPolicy,
    ...exec,
    groupActivation,
    ...(options.usage === undefined ? [] : [options.usage]),
    help,
  ]
}
