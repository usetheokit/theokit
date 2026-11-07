import { createHash } from 'node:crypto'

import type { HookApprovalGate, HookApprovalRequest } from '@theokit/sdk'

import { TheoClawConfigError } from '../control-plane/errors.js'

/** The variable that lists the fingerprints of the hook commands an owner approved (B-397 FR-007). */
export const APPROVED_HOOKS_VARIABLE = 'THEOCLAW_APPROVED_HOOKS'

const FINGERPRINT = /^[0-9a-f]{64}$/

/**
 * The fingerprints `THEOCLAW_APPROVED_HOOKS` lists, comma-separated, each trimmed and lower-cased.
 * Unset or blank lists none. An item that is not 64 hex characters refuses the start, naming the
 * variable and the item's position, never the value.
 */
export function parseApprovedHooks(env: Readonly<Record<string, string | undefined>>): ReadonlySet<string> {
  const raw = (env[APPROVED_HOOKS_VARIABLE] ?? '').trim()
  if (raw === '') return new Set()
  const items = raw.split(',').map((item) => item.trim().toLowerCase())
  items.forEach((item, index) => {
    if (!FINGERPRINT.test(item)) {
      throw new TheoClawConfigError(
        `${APPROVED_HOOKS_VARIABLE} item ${index + 1} is not a hook fingerprint (64 hex characters)`,
        { variable: APPROVED_HOOKS_VARIABLE },
      )
    }
  })
  return new Set(items)
}

/**
 * The hex sha256 of the hook's event key as its file spells it, its command and the timeout the
 * SDK will apply, one per line. The SDK reports all three so an approval matches what the owner
 * was shown (`HookApprovalRequest.sourceEvent`).
 */
export function hookFingerprint(request: Pick<HookApprovalRequest, 'sourceEvent' | 'command' | 'timeoutMs'>): string {
  return createHash('sha256').update(`${request.sourceEvent}\n${request.command}\n${request.timeoutMs}`).digest('hex')
}

/** One gate for every agent built with no approved hook, so two such option objects stay equal. */
const REFUSE_ALL_HOOKS: HookApprovalGate = { approve: () => false }

/** A gate that runs a hook command only when its fingerprint is in `approved`. */
export function createHookApprovalGate(approved: ReadonlySet<string>): HookApprovalGate {
  if (approved.size === 0) return REFUSE_ALL_HOOKS
  return { approve: (request) => approved.has(hookFingerprint(request)) }
}
