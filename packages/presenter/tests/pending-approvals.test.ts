import { describe, expect, it } from 'vitest'

import { pendingApprovals, readPendingApproval } from '../src/index.js'

const part = (over: Record<string, unknown> = {}) =>
  ({
    type: 'tool-bash',
    toolCallId: 'c1',
    toolName: 'bash',
    state: 'approval-requested',
    input: { cmd: 'ls' },
    approval: { id: 'a1', question: 'Run it?', timeoutMs: 5000 },
    ...over,
  }) as never

describe('pendingApprovals', () => {
  it('an approval-requested part with approval id, question and timeout reads into one entry', () => {
    expect(pendingApprovals([{ parts: [part()] }])).toEqual([
      {
        approvalId: 'a1',
        toolCallId: 'c1',
        toolName: 'bash',
        input: { cmd: 'ls' },
        question: 'Run it?',
        timeoutMs: 5000,
      },
    ])
  })

  it('a part without approval.id is skipped and never settled by its toolCallId', () => {
    expect(readPendingApproval(part({ approval: {} }))).toBeUndefined()
    expect(readPendingApproval(part({ approval: undefined }))).toBeUndefined()
    expect(pendingApprovals([{ parts: [part({ approval: {} })] }])).toEqual([])
  })

  it('two outstanding approvals across messages come back in order', () => {
    const r = pendingApprovals([
      { parts: [part({ toolCallId: 'c1', approval: { id: 'a1' } })] },
      { parts: [part({ toolCallId: 'c2', approval: { id: 'a2' } })] },
    ])
    expect(r.map((e) => e.approvalId)).toEqual(['a1', 'a2'])
  })

  it('no outstanding approval returns the same empty array twice', () => {
    const msgs = [{ parts: [part({ state: 'output-available' })] }]
    expect(pendingApprovals(msgs)).toBe(pendingApprovals([]))
  })
})
