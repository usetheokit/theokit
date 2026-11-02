/**
 * B-397 FR-007 (AC-003): every TheoClaw agent carries a hook approval gate that runs only the hook
 * commands whose fingerprint the owner listed in `THEOCLAW_APPROVED_HOOKS`.
 */
import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createHookApprovalGate, hookFingerprint, parseApprovedHooks } from '../src/agent/hook-approval.js'
import { TheoClawConfigError } from '../src/control-plane/errors.js'

const STOP_HOOK = { command: 'touch x', event: 'stop', sourceEvent: 'Stop', timeoutMs: 30_000 } as const

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The refusal `parseApprovedHooks` throws for `value`, which must be a `TheoClawConfigError`. */
function refusal(value: string): TheoClawConfigError {
  try {
    parseApprovedHooks({ THEOCLAW_APPROVED_HOOKS: value })
  } catch (error) {
    expect(error).toBeInstanceOf(TheoClawConfigError)
    return error as TheoClawConfigError
  }
  throw new Error('parseApprovedHooks accepted the value')
}

describe('hookFingerprint', () => {
  it('is the hex sha256 of the source event, the command and the timeout, one per line', () => {
    expect(hookFingerprint(STOP_HOOK)).toBe(sha256('Stop\ntouch x\n30000'))
  })

  it('changes when the timeout changes', () => {
    expect(hookFingerprint({ ...STOP_HOOK, timeoutMs: 5_000 })).not.toBe(hookFingerprint(STOP_HOOK))
  })

  it('changes when the source event changes', () => {
    expect(hookFingerprint({ ...STOP_HOOK, sourceEvent: 'PreToolUse' })).not.toBe(hookFingerprint(STOP_HOOK))
  })

  it('changes when the command changes', () => {
    expect(hookFingerprint({ ...STOP_HOOK, command: 'touch y' })).not.toBe(hookFingerprint(STOP_HOOK))
  })
})

describe('createHookApprovalGate', () => {
  it('refuses a hook when no fingerprint is listed', async () => {
    expect(await createHookApprovalGate(new Set()).approve?.(STOP_HOOK)).toBe(false)
  })

  it('refuses a hook whose fingerprint is not listed', async () => {
    const other = hookFingerprint({ ...STOP_HOOK, command: 'touch other' })
    expect(await createHookApprovalGate(new Set([other])).approve?.(STOP_HOOK)).toBe(false)
  })

  it('approves a hook whose fingerprint is listed', async () => {
    expect(await createHookApprovalGate(new Set([hookFingerprint(STOP_HOOK)])).approve?.(STOP_HOOK)).toBe(true)
  })
})

describe('parseApprovedHooks', () => {
  it('reads an unset list as no approved hook', () => {
    expect(parseApprovedHooks({})).toEqual(new Set())
  })

  it('reads an empty or blank list as no approved hook', () => {
    expect(parseApprovedHooks({ THEOCLAW_APPROVED_HOOKS: '' })).toEqual(new Set())
    expect(parseApprovedHooks({ THEOCLAW_APPROVED_HOOKS: '  ' })).toEqual(new Set())
  })

  it('trims and lower-cases each listed fingerprint', () => {
    const fingerprint = hookFingerprint(STOP_HOOK)
    const listed = parseApprovedHooks({ THEOCLAW_APPROVED_HOOKS: ` ${fingerprint.toUpperCase()} , ${sha256('other')}` })
    expect(listed).toEqual(new Set([fingerprint, sha256('other')]))
  })

  it('refuses an item that is not 64 hex characters, naming the variable and the position, never the value', () => {
    const error = refusal(`${sha256('a')},not-a-fingerprint`)
    expect(error.variable).toBe('THEOCLAW_APPROVED_HOOKS')
    expect(error.message).toContain('THEOCLAW_APPROVED_HOOKS')
    expect(error.message).toContain('2')
    expect(error.message).not.toContain('not-a-fingerprint')
  })

  it('refuses an empty entry between two fingerprints', () => {
    expect(refusal(`${sha256('a')},,${sha256('b')}`).variable).toBe('THEOCLAW_APPROVED_HOOKS')
  })
})
