import { PermissionEngine } from '@theokit/sdk'
import type { SandboxPosture } from '@theokit/sdk/sandbox'
import { describe, expect, it } from 'vitest'

import {
  applyPosture,
  approvalPostureFor,
  onAskForPolicy,
} from '../../src/bridge/approval-posture.js'

const enforced: SandboxPosture = { mode: 'workspace-write', enforced: true, detail: 'bwrap' }
const unenforced: SandboxPosture = { mode: 'workspace-write', enforced: false, detail: 'no bwrap' }
const danger: SandboxPosture = { mode: 'danger-full-access', enforced: false, detail: 'opt-out' }
const interactive = { emit: () => undefined, awaitApproval: () => Promise.resolve(true) }

describe('approvalPostureFor', () => {
  it('never does not ask when confined or waived', () => {
    expect(approvalPostureFor('never', enforced, { interactive }).kind).toBe('auto-approve')
    expect(approvalPostureFor('never', danger).kind).toBe('auto-approve')
  })
  it('never does not ask, and rejects, when unconfined', () => {
    expect(approvalPostureFor('never', unenforced, { interactive }).kind).toBe('auto-reject')
  })
  it('untrusted and on-request ask when a human is there', () => {
    expect(approvalPostureFor('untrusted', enforced, { interactive }).kind).toBe('interactive')
    expect(approvalPostureFor('on-request', enforced, { interactive }).kind).toBe('interactive')
  })
  it('refuses when headless', () => {
    expect(approvalPostureFor('untrusted', enforced).kind).toBe('auto-reject')
  })

  it('untrusted gates a tool no rule matched: the engine asks and the posture installs the gate', () => {
    const engine = new PermissionEngine([{ tool: 'Read', action: 'allow' }], {
      defaultAction: 'ask',
    })
    expect(engine.evaluate('mystery_tool')).toBe('ask')
    const extra: Record<string, unknown> = {}
    const gated = new Map([['mystery_tool', { approve: true }]]) as never
    applyPosture(extra, {}, approvalPostureFor('untrusted', enforced, { interactive }), gated)
    expect(extra.plugins).toHaveLength(1)
  })
})

describe('onAskForPolicy', () => {
  it('never allows every unmatched tool', async () => {
    expect(await onAskForPolicy('never', new Set())('Read', {})).toEqual({ behavior: 'allow' })
  })
  it('an asking policy allows a gated tool and denies the rest naming it', async () => {
    const onAsk = onAskForPolicy('untrusted', new Set(['Edit']))
    expect(await onAsk('Edit', {})).toEqual({ behavior: 'allow' })
    const denied = await onAsk('Read', {})
    expect(denied.behavior).toBe('deny')
    expect(denied).toHaveProperty('message', expect.stringContaining('Read'))
  })
  it('uses the caller refusal text', async () => {
    const onAsk = onAskForPolicy('on-request', new Set(), { refusal: (t, p) => `${t}/${p}` })
    expect(await onAsk('Read', {})).toEqual({ behavior: 'deny', message: 'Read/on-request' })
  })
})
