/**
 * M14 (theokit-ai-first) — GET /api/agents/:name/approvals lists pending HITL approvals.
 *
 * The in-process ApprovalRegistry now tracks pending-approval metadata and exposes `list()`; the
 * handler serves it as JSON. Single-process contract (ADR 0038) — the list is process-wide; a
 * durable/multi-tenant store is the documented follow-up.
 *
 * TDD RED-first.
 */
import { describe, expect, it } from 'vitest'

import { createInProcessApprovalRegistry } from '../../packages/theo/src/server/agent/approval-registry.js'
import {
  handleListApprovals,
  isListApprovalsPath,
} from '../../packages/theo/src/server/agent/list-approvals-handler.js'

describe('ApprovalRegistry.list', () => {
  it('lists pending approvals with their metadata and omits settled ones', () => {
    const reg = createInProcessApprovalRegistry()
    void reg.register('a1', { timeoutMs: 60_000, onTimeout: 'abort', toolName: 'deploy', question: 'Deploy?' })
    void reg.register('a2', { timeoutMs: 60_000, onTimeout: 'abort', toolName: 'delete', question: 'Delete?' })

    reg.resolve('a1', true) // settle one

    const pending = reg.list()
    expect(pending.map((p) => p.approvalId)).toEqual(['a2'])
    expect(pending[0]).toMatchObject({ approvalId: 'a2', toolName: 'delete', question: 'Delete?' })
    expect(typeof pending[0].expiresAt).toBe('number')
  })

  it('returns an empty list when nothing is pending', () => {
    expect(createInProcessApprovalRegistry().list()).toEqual([])
  })
})

describe('isListApprovalsPath', () => {
  it('matches the approvals listing path and extracts the agent name', () => {
    expect(isListApprovalsPath('/api/agents/ops/approvals')).toBe('ops')
  })
  it('returns null for other agent paths', () => {
    expect(isListApprovalsPath('/api/agents/ops')).toBeNull()
    expect(isListApprovalsPath('/api/agents/ops/approve/abc')).toBeNull()
  })
})

describe('handleListApprovals', () => {
  it('returns 200 JSON with the pending approvals', async () => {
    const reg = createInProcessApprovalRegistry()
    void reg.register('x', { timeoutMs: 60_000, onTimeout: 'abort', toolName: 't', question: 'q?' })

    const res = handleListApprovals(reg)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { approvals: { approvalId: string }[] }
    expect(body.approvals.map((a) => a.approvalId)).toEqual(['x'])
  })
})
