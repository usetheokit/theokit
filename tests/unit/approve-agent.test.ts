/**
 * M4 (theokit-ai-first) — the HITL approve endpoint (`POST /api/agents/<name>/approve/<id>`).
 * Resolves the pending approval a paused run awaits. CSRF-guarded like `mountAgent`; idempotent
 * on double-submit (404 the second time); 400 on a malformed path or body. Registry is injected —
 * these tests pass a fresh in-process registry and assert the awaited Promise settles.
 */
import { describe, expect, it } from 'vitest'

import { createInProcessApprovalRegistry } from '../../packages/theo/src/server/agent/approval-registry.js'
import {
  handleAgentApproval,
  parseApprovalId,
  isApprovalPath,
} from '../../packages/theo/src/server/agent/approve-agent.js'

const PATH = '/api/agents/ops/approve/abc-123'

/** A same-origin POST carrying the custom CSRF header the client sends. */
function approveRequest(approved: boolean): Request {
  return new Request(`http://localhost${PATH}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-theo-action': '1',
      origin: 'http://localhost',
      host: 'localhost',
    },
    body: JSON.stringify({ approved }),
  })
}

describe('parseApprovalId (M4)', () => {
  it('test_extracts_id_from_approve_path', () => {
    expect(parseApprovalId('/api/agents/ops/approve/abc-123')).toBe('abc-123')
  })
  it('test_null_when_no_approve_segment', () => {
    expect(parseApprovalId('/api/agents/ops')).toBeNull()
  })
  it('test_null_on_empty_or_nested_id', () => {
    expect(parseApprovalId('/api/agents/ops/approve/')).toBeNull()
    expect(parseApprovalId('/api/agents/ops/approve/a/b')).toBeNull()
  })
  it('test_isApprovalPath', () => {
    expect(isApprovalPath('/api/agents/ops/approve/x')).toBe(true)
    expect(isApprovalPath('/api/agents/ops')).toBe(false)
  })
})

describe('handleAgentApproval (M4)', () => {
  it('test_resolves_a_pending_approval_and_returns_200', async () => {
    const reg = createInProcessApprovalRegistry()
    const pending = reg.register('abc-123', { timeoutMs: 10_000, onTimeout: 'abort' })

    const res = await handleAgentApproval(approveRequest(true), PATH, reg, 'strict')

    expect(res.status).toBe(200)
    await expect(pending).resolves.toEqual({ approved: true })
  })

  it('test_deny_settles_the_pending_promise_false', async () => {
    const reg = createInProcessApprovalRegistry()
    const pending = reg.register('abc-123', { timeoutMs: 10_000, onTimeout: 'abort' })

    const res = await handleAgentApproval(approveRequest(false), PATH, reg, 'strict')

    expect(res.status).toBe(200)
    await expect(pending).resolves.toEqual({ approved: false })
  })

  it('test_unknown_id_returns_404', async () => {
    const reg = createInProcessApprovalRegistry()
    const res = await handleAgentApproval(approveRequest(true), PATH, reg, 'strict')
    expect(res.status).toBe(404)
  })

  it('test_double_submit_is_404_second_time', async () => {
    const reg = createInProcessApprovalRegistry()
    void reg.register('abc-123', { timeoutMs: 10_000, onTimeout: 'abort' })
    expect((await handleAgentApproval(approveRequest(true), PATH, reg, 'strict')).status).toBe(200)
    expect((await handleAgentApproval(approveRequest(true), PATH, reg, 'strict')).status).toBe(404)
  })

  it('test_missing_boolean_approved_is_400', async () => {
    const reg = createInProcessApprovalRegistry()
    void reg.register('abc-123', { timeoutMs: 10_000, onTimeout: 'abort' })
    const req = new Request(`http://localhost${PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-theo-action': '1',
        origin: 'http://localhost',
        host: 'localhost',
      },
      body: JSON.stringify({ notApproved: true }),
    })
    expect((await handleAgentApproval(req, PATH, reg, 'strict')).status).toBe(400)
  })

  it('test_cross_origin_post_is_403_and_does_not_resolve', async () => {
    const reg = createInProcessApprovalRegistry()
    let settled = false
    void reg.register('abc-123', { timeoutMs: 10_000, onTimeout: 'abort' }).then(() => {
      settled = true
    })
    const evil = new Request(`http://localhost${PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-theo-action': '1',
        origin: 'http://evil.example',
        host: 'localhost',
      },
      body: JSON.stringify({ approved: true }),
    })
    const res = await handleAgentApproval(evil, PATH, reg, 'strict')
    expect(res.status).toBe(403)
    await Promise.resolve()
    expect(settled).toBe(false) // the paused run was NOT resolved by a forged request
  })

  it('test_csrf_off_allows_approval', async () => {
    const reg = createInProcessApprovalRegistry()
    const pending = reg.register('abc-123', { timeoutMs: 10_000, onTimeout: 'abort' })
    const bare = new Request(`http://localhost${PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved: true }),
    })
    const res = await handleAgentApproval(bare, PATH, reg, 'off')
    expect(res.status).toBe(200)
    await expect(pending).resolves.toEqual({ approved: true })
  })
})
