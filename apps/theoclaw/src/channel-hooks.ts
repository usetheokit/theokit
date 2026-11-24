import type { GatewayHook, MessageEvent, PairingStore } from '@theokit/gateway'

import { createOwnerPolicyHook } from './authorization/owner-policy-hook.js'
import { type AuthorizationPolicy, isPolicyOwner } from './authorization/policy.js'
import { createAcpCommandHook, type AcpSessions } from './channels/acp-command.js'
import { createInfoHook } from './channels/info-commands.js'
import { createHelpHook } from './channels/help-hook.js'
import { createWorkflowApproveHook } from './channels/workflow-approve-hook.js'
import { createGroupActivationHook } from './channels/group-activation-hook.js'

export interface ChannelHookOptions {
  readonly policy: AuthorizationPolicy
  /** The pairing store; absent without a state directory, where the hook runs without one. */
  readonly pairing?: PairingStore
  /** The masked write the hooks report through. */
  readonly write: (line: string) => void
  /** The e-mail trigger (OC-17): run first, so an e-mail never reaches the owner policy or a chat session. */
  readonly emailTrigger?: GatewayHook
  /** The `/usage` hook (B-400 FR-005), run third. */
  readonly usage?: GatewayHook
  /** The model `/status` and `/model` report; absent: those two are ordinary messages. */
  readonly model?: string
  /** The ACP sessions `/acp` starts, lists and stops (B-685), owners only; absent: no `/acp`. */
  readonly acp?: AcpSessions
  /** The chat exec approval: `/approve`, `/deny`, `/elevated` (B-572), run after the owner policy. */
  /** Resumes a suspended user workflow run: `/approve <token>`, `/deny <token>`; absent: no such command. */
  readonly workflowResume?: (token: string, approved: boolean) => Promise<string | undefined>
  readonly execApproval?: { readonly hook: GatewayHook; hasPending(event: MessageEvent): boolean }
}

/** The hooks of one assistant in the places `createChannelAssistant` gives them: before the policy, the policy, after it, and help. */
export interface ChannelHookParts {
  readonly pre: readonly GatewayHook[]
  readonly access: GatewayHook
  readonly app: readonly GatewayHook[]
  readonly help: GatewayHook
}

/**
 * The gateway hooks, by place. The e-mail trigger runs before the owner policy; the owner policy
 * is next, so every later hook sees only owners and paired senders (FR-007); `/usage` is answered
 * last before help.
 */
export function channelHookParts(options: ChannelHookOptions): ChannelHookParts {
  const { policy, pairing, write } = options
  const access = createOwnerPolicyHook({ policy, ...(options.execApproval === undefined ? {} : { execPending: options.execApproval.hasPending }), ...(pairing === undefined ? {} : { pairing }), write })
  const groupActivation = createGroupActivationHook({
    isOwner: (platform, senderId) => isPolicyOwner(policy, platform, senderId),
    mode: policy.groupActivation,
    write,
  })
  const exec = options.execApproval === undefined ? [] : [options.execApproval.hook]
  const workflows = options.workflowResume === undefined ? [] : [createWorkflowApproveHook({ resume: options.workflowResume, isOwner: (platform, id) => isPolicyOwner(policy, platform, id) })]
  const acp = options.acp === undefined ? [] : [createAcpCommandHook({ sessions: options.acp, isOwner: (event) => isPolicyOwner(policy, event.platform, event.sender.id) })]
  return {
    pre: options.emailTrigger === undefined ? [] : [options.emailTrigger],
    access,
    app: [...workflows, ...exec, ...acp, groupActivation, ...(options.usage === undefined ? [] : [options.usage]), ...(options.model === undefined ? [] : [createInfoHook(options.model)])],
    help: createHelpHook(),
  }
}

/** Every hook in the order the runner runs them: `pre`, `access`, `app`, `help`. */
export function channelHooks(options: ChannelHookOptions): readonly GatewayHook[] {
  const parts = channelHookParts(options)
  return [...parts.pre, parts.access, ...parts.app, parts.help]
}
