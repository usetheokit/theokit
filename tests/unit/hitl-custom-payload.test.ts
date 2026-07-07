import { describe, expect, it } from 'vitest'

import {
  handleAgentApproval,
  parseApprovalBody,
} from '../../packages/theo/src/server/agent/approve-agent.js'
import { createInProcessApprovalRegistry } from '../../packages/theo/src/server/agent/approval-registry.js'

/**
 * M20 — HITL custom approval payload. The approver may attach a `payload` object (and a `reason`)
 * to the decision, beyond the bare `approved: boolean`. The decision surfaces to the model (on
 * denial, via the veto message) and to the UI (via `list()` + the approval event's `payloadSchema`).
 * Backward-compatible: `{ approved }` and `{ approved, reason }` still work.
 */

function csrfHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', 'X-Theo-Action': '1', origin: 'http://localhost' }
}

describe('M20 — parseApprovalBody', () => {
  it('accepts the legacy { approved } shape (backward-compatible)', () => {
    expect(parseApprovalBody({ approved: true })).toEqual({ approved: true })
    expect(parseApprovalBody({ approved: false })).toEqual({ approved: false })
  })

  it('accepts an optional reason', () => {
    expect(parseApprovalBody({ approved: false, reason: 'looks risky' })).toEqual({
      approved: false,
      reason: 'looks risky',
    })
  })

  it('accepts an optional payload object', () => {
    expect(
      parseApprovalBody({ approved: true, payload: { editedArgs: { limit: 5 }, note: 'ok' } }),
    ).toEqual({ approved: true, payload: { editedArgs: { limit: 5 }, note: 'ok' } })
  })

  it('rejects a body without a boolean approved', () => {
    expect(parseApprovalBody({ reason: 'x' })).toBeNull()
    expect(parseApprovalBody(null)).toBeNull()
    expect(parseApprovalBody('nope')).toBeNull()
  })

  it('rejects a payload that exceeds the size cap', () => {
    const huge = { blob: 'x'.repeat(64 * 1024) }
    expect(parseApprovalBody({ approved: true, payload: huge })).toBeNull()
  })

  it('rejects a non-object payload', () => {
    expect(parseApprovalBody({ approved: true, payload: 'string-not-object' })).toBeNull()
  })
})

describe('M20 — registry carries the decision (approved + reason + payload)', () => {
  it('resolves the pending Promise with the full decision object', async () => {
    const reg = createInProcessApprovalRegistry()
    const pending = reg.register('id-1', { timeoutMs: 10_000, onTimeout: 'abort' })
    const ok = reg.resolve('id-1', { approved: true, reason: 'go', payload: { extra: 1 } })
    expect(ok).toBe(true)
    await expect(pending).resolves.toEqual({ approved: true, reason: 'go', payload: { extra: 1 } })
  })

  it('accepts a bare boolean on resolve (backward-compatible)', async () => {
    const reg = createInProcessApprovalRegistry()
    const pending = reg.register('id-2', { timeoutMs: 10_000, onTimeout: 'abort' })
    reg.resolve('id-2', false)
    await expect(pending).resolves.toEqual({ approved: false })
  })

  it('a timeout resolves to a decision object (proceed → approved:true)', async () => {
    const reg = createInProcessApprovalRegistry()
    const decision = await reg.register('id-3', { timeoutMs: 1, onTimeout: 'proceed' })
    expect(decision).toEqual({ approved: true })
  })

  it('list() surfaces a declared payloadSchema', () => {
    const reg = createInProcessApprovalRegistry()
    void reg.register('id-4', {
      timeoutMs: 10_000,
      onTimeout: 'abort',
      toolName: 'delete_file',
      payloadSchema: { type: 'object', properties: { note: { type: 'string' } } },
    })
    const pending = reg.list().find((p) => p.approvalId === 'id-4')
    expect(pending?.payloadSchema).toEqual({
      type: 'object',
      properties: { note: { type: 'string' } },
    })
  })
})

describe('M20 — approve route threads the decision to the registry', () => {
  it('resolves with reason + payload from the POST body', async () => {
    const reg = createInProcessApprovalRegistry()
    const pending = reg.register('id-5', { timeoutMs: 10_000, onTimeout: 'abort' })
    const req = new Request('http://localhost/api/agents/x/approve/id-5', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ approved: false, reason: 'unsafe', payload: { severity: 'high' } }),
    })
    const res = await handleAgentApproval(req, '/api/agents/x/approve/id-5', reg, 'strict')
    expect(res.status).toBe(200)
    await expect(pending).resolves.toEqual({
      approved: false,
      reason: 'unsafe',
      payload: { severity: 'high' },
    })
  })

  it('still works with the legacy { approved } body', async () => {
    const reg = createInProcessApprovalRegistry()
    const pending = reg.register('id-6', { timeoutMs: 10_000, onTimeout: 'abort' })
    const req = new Request('http://localhost/api/agents/x/approve/id-6', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ approved: true }),
    })
    const res = await handleAgentApproval(req, '/api/agents/x/approve/id-6', reg, 'strict')
    expect(res.status).toBe(200)
    await expect(pending).resolves.toEqual({ approved: true })
  })

  it('400s when the payload exceeds the cap', async () => {
    const reg = createInProcessApprovalRegistry()
    void reg.register('id-7', { timeoutMs: 10_000, onTimeout: 'abort' })
    const req = new Request('http://localhost/api/agents/x/approve/id-7', {
      method: 'POST',
      headers: csrfHeaders(),
      body: JSON.stringify({ approved: true, payload: { blob: 'x'.repeat(64 * 1024) } }),
    })
    const res = await handleAgentApproval(req, '/api/agents/x/approve/id-7', reg, 'strict')
    expect(res.status).toBe(400)
  })
})
