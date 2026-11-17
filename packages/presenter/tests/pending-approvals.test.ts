import { describe, expect, it } from 'vitest'

import * as root from '../src/index.js'
import { pendingApprovals, readPendingApproval } from '../src/approvals/pending-approvals.js'

const part = (over: Record<string, unknown> = {}) => ({
  type: 'tool-x',
  toolCallId: 'c1',
  toolName: 'x',
  input: { a: 1 },
  state: 'approval-requested',
  approval: { id: 'a1' },
  ...over,
})

describe('pendingApprovals', () => {
  it('an approval-requested part with approval id, question and timeout reads into one entry', () => {
    const p = part({ approval: { id: 'a1', question: 'ok?', timeoutMs: 500 } })
    expect(pendingApprovals([{ parts: [p as never] }])).toEqual([
      { approvalId: 'a1', toolCallId: 'c1', toolName: 'x', input: { a: 1 }, question: 'ok?', timeoutMs: 500 },
    ])
    expect(root.pendingApprovals).toBe(pendingApprovals)
    expect(root.readPendingApproval).toBe(readPendingApproval)
  })

  it('a part without approval.id is skipped and never settled by its toolCallId', () => {
    expect(readPendingApproval(part({ approval: {} }))).toBeUndefined()
    expect(readPendingApproval(part({ approval: undefined }))).toBeUndefined()
    expect(readPendingApproval(null)).toBeUndefined()
    expect(pendingApprovals([{ parts: [part({ approval: {} }) as never] }])).toEqual([])
  })

  it('two outstanding approvals across messages come back in order', () => {
    const r = pendingApprovals([
      { parts: [part() as never] },
      { parts: [part({ state: 'output-available' }) as never, part({ toolCallId: 'c2', approval: { id: 'a2' } }) as never] },
    ])
    expect(r.map((e) => e.approvalId)).toEqual(['a1', 'a2'])
  })

  it('no outstanding approval returns the same empty array twice', () => {
    expect(pendingApprovals([])).toBe(pendingApprovals([{ parts: [] }]))
  })
})
