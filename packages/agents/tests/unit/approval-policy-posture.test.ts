import type { SandboxPosture } from '@theokit/sdk/sandbox'
import { describe, expect, it } from 'vitest'

import { approvalPostureFor } from '../../src/bridge/approval-posture.js'

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
})
