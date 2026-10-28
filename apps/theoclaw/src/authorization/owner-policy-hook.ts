import { redactSecrets } from '@theokit/gateway'
import type { GatewayHook, HookDecision, MessageEvent } from '@theokit/gateway'

import type { PairingStore } from './pairing-store.js'
import { isAuthenticatedSender, isPolicyOwner, senderKey } from './policy.js'
import type { AuthorizationPolicy } from './policy.js'

const HOOK_NAME = 'theoclaw-owner-policy'
/** A refused DM sender is answered at most once per hour (NFR-004), which ends a two-instance loop (D1). */
const REFUSAL_MEMORY_MS = 3_600_000
/** The command word alone or followed by whitespace; `/approver` is not it. */
const APPROVE_COMMAND = /^\/approve(\s|$)/
const APPROVE = /^\/approve\s+(\d{6})$/

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
  /** Where a failure of the hook is reported. Default: standard error. */
  readonly write?: (line: string) => void
}

function pairingMessage(code: string): string {
  return `Pairing code: ${code}. Ask the owner to send /approve ${code} in a direct message.`
}

/** The owner's `/approve <code>`: always blocked, so the command never reaches the agent (D2). */
async function approval(text: string, pairing: PairingStore | undefined): Promise<HookDecision> {
  if (pairing === undefined) return { block: true, message: PAIRING_OFF }
  const code = APPROVE.exec(text)?.[1]
  if (code === undefined) return { block: true, message: INVALID_CODE }
  const result = await pairing.approve(code)
  if (result.ok) return { block: true, message: PAIRED }
  return { block: true, message: result.reason === 'write_failed' ? NOT_SAVED : INVALID_CODE }
}

/**
 * The `pre_inbound` hook that lets owners and paired senders through and refuses everyone else as
 * the DM policy says. In a group a refused sender gets no reply under any policy (FR-004), so two
 * instances there never answer each other.
 */
export function createOwnerPolicyHook(options: OwnerPolicyHookOptions): GatewayHook {
  const { policy, pairing } = options
  const clock = options.clock ?? Date.now
  const write = options.write ?? ((line: string) => void process.stderr.write(`${line}\n`))
  const refusals = new Map<string, number>()

  const forgetOld = (now: number): void => {
    for (const [key, at] of refusals) if (now - at >= REFUSAL_MEMORY_MS) refusals.delete(key)
  }
  const refusalFor = (event: MessageEvent): string =>
    policy.dmPolicy === 'pairing' && pairing !== undefined
      ? pairingMessage(pairing.issue(event.platform, event.sender.id))
      : policy.refusalText

  /** A DM from someone neither an owner nor paired. */
  const refuseDm = (event: MessageEvent, key: string, now: number): HookDecision | undefined => {
    if (policy.dmPolicy === 'open') return undefined
    // An unauthenticated sender can never be admitted, and a reply would go to the address it
    // wrote, so answering would send mail or texts to whoever a forger names (backscatter).
    if (policy.dmPolicy === 'disabled' || !isAuthenticatedSender(event.platform) || refusals.has(key)) return SILENT
    // The reply is built first: a sender whose code could not be issued is not silenced for an hour.
    const message = refusalFor(event)
    refusals.set(key, now)
    return { block: true, message }
  }

  const decide = async (event: MessageEvent): Promise<HookDecision | undefined> => {
    const now = clock()
    forgetOld(now)
    const isOwner = isPolicyOwner(policy, event.platform, event.sender.id)
    const isDm = event.channel.type === 'dm'
    const text = event.text.trim()
    if (isOwner && isDm && APPROVE_COMMAND.test(text)) return approval(text, pairing)
    const paired = isAuthenticatedSender(event.platform) && (pairing?.isPaired(event.platform, event.sender.id) ?? false)
    if (isOwner || paired) return undefined
    return isDm ? refuseDm(event, senderKey(event.platform, event.sender.id), now) : SILENT
  }

  return {
    name: HOOK_NAME,
    async pre_inbound({ event }) {
      try {
        return await decide(event)
      } catch (error) {
        // Never thrown on: the runner would answer "hook failed" into the chat, a group included (EC-1).
        const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        try {
          write(`${HOOK_NAME}: ${event.platform}: ${redactSecrets(reason)}`)
        } catch {
          // A failing log sink must not turn this silent block into the runner's chat reply.
          process.stderr.write(`${HOOK_NAME}: ${event.platform}: the hook failed and its log line could not be written\n`)
        }
        return SILENT
      }
    },
  }
}
