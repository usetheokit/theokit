import { createAccessPolicyHook, redactSecrets } from '@theokit/gateway'
import type { GatewayHook, HookDecision, MessageEvent, PairingStore } from '@theokit/gateway'

import { isAuthenticatedSender, isPolicyOwner } from './policy.js'
import type { AuthorizationPolicy } from './policy.js'

const HOOK_NAME = 'theoclaw-owner-policy'
/** The command word alone or followed by whitespace; `/approver` is not it. */
const APPROVE_COMMAND = /^\/approve(\s|$)/
/** What answers an exec question rather than a pairing code. */
const EXEC_ANSWER = /^\/approve(?:\s+always)?$/
const APPROVE_WITH_CODE = /^\/approve\s+\d{6}$/

const PAIRED = 'Paired.'
const INVALID_CODE = 'That code is not valid or has expired.'
const NOT_SAVED = 'The pairing could not be saved.'
const PAIRING_OFF = 'Pairing is off: set THEOCLAW_STATE_DIR to keep pairings.'

const SILENT: HookDecision = { block: true }

export interface OwnerPolicyHookOptions {
  readonly policy: AuthorizationPolicy
  /** Present only when `THEOCLAW_STATE_DIR` is set; always under the `pairing` policy. */
  readonly pairing?: PairingStore
  readonly clock?: () => number
  /** True when a bare `/approve` answers an exec waiting in the event's chat, not a pairing: the hook passes it on. */
  readonly execPending?: (event: MessageEvent) => boolean
  /** Where a failure of the hook is reported. Default: standard error. */
  readonly write?: (line: string) => void
}

/**
 * The `pre_inbound` hook that lets owners and paired senders through and refuses everyone else as
 * the DM policy says: the gateway's access policy with TheoClaw's reply texts, plus three things
 * the gateway does not do. An owner's `/approve` in a group goes on to the agent untouched (only a
 * DM approves a pairing); a bare `/approve` in a DM answers "not valid" unless it answers a waiting
 * exec; and a DM from an unauthenticated platform is let through under the `open` policy.
 */
export function createOwnerPolicyHook(options: OwnerPolicyHookOptions): GatewayHook {
  const { policy, pairing } = options
  const owns = (event: MessageEvent): boolean => isPolicyOwner(policy, event.platform, event.sender.id)
  const isDm = (event: MessageEvent): boolean => event.channel.type === 'dm'
  const authenticated = (keys: ReadonlySet<string>): Set<string> =>
    new Set([...keys].filter((key) => isAuthenticatedSender(key.slice(0, Math.max(key.indexOf(':'), 0)))))

  const gateway = createAccessPolicyHook({
    owners: authenticated(policy.owners),
    allowed: authenticated(policy.allowed),
    // Without a store `pairing` cannot issue codes: the refusal text answers instead.
    dm: policy.dmPolicy === 'pairing' && pairing === undefined ? 'allowlist' : policy.dmPolicy,
    groups: 'silent',
    isAuthenticated: isAuthenticatedSender,
    ...(pairing === undefined ? {} : { pairing }),
    refusalText: policy.refusalText,
    messages: {
      pairingCode: (code) => `Pairing code: ${code}. Ask the owner to send /approve ${code} in a direct message.`,
      invalidCode: INVALID_CODE,
      failedSave: NOT_SAVED,
      paired: PAIRED,
      pairingOff: PAIRING_OFF,
    },
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.write === undefined ? {} : { write: options.write }),
    passThrough: (event) => {
      // The owner's group `/approve` is not a pairing: it goes on, as every other owner message does.
      if (owns(event)) return !isDm(event)
      return policy.dmPolicy === 'open' && isDm(event)
    },
  })

  return {
    name: HOOK_NAME,
    async pre_inbound(context) {
      const { event } = context
      try {
        const text = event.text.trim()
        if (owns(event) && isDm(event) && APPROVE_COMMAND.test(text) && !(options.execPending?.(event) === true && EXEC_ANSWER.test(text))) {
          if (pairing === undefined) return { block: true, message: PAIRING_OFF }
          // The gateway lets a bare `/approve` through to the agent; here it is a pairing command without its code.
          if (!APPROVE_WITH_CODE.test(text)) return { block: true, message: INVALID_CODE }
          return await gateway.pre_inbound?.(context)
        }
        return await gateway.pre_inbound?.(context)
      } catch (error) {
        // Never thrown on: the runner would answer "hook failed" into the chat, a group included (EC-1).
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        try {
          ;(options.write ?? ((line: string) => void process.stderr.write(`${line}\n`)))(`${HOOK_NAME}: ${event.platform}: ${redactSecrets(reason)}`)
        } catch {
          process.stderr.write(`${HOOK_NAME}: ${event.platform}: the hook failed and its log line could not be written\n`)
        }
        return SILENT
      }
    },
  }
}
