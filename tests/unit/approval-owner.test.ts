import { describe, it, expect } from 'vitest'

import { handleAgentApproval } from '../../packages/theo/src/server/agent/approve-agent.js'
import { createInProcessApprovalRegistry } from '../../packages/theo/src/server/agent/approval-registry.js'

/**
 * B-016 (remaining half) — the approval ledger recorded no owner, so two subjects
 * admitted to one agent could settle each other's approvals.
 *
 * `agent-access.ts` states the gap in the open: *"The framework cannot tell a
 * policy who OWNS this approval: the ledger keys by a bare id and records no
 * owner. That gap is real and is not closed here."* This closes the ledger half
 * — the registry can now be asked, which is the fact the approve route needs
 * before it can refuse anyone.
 *
 * ## The rule is deliberately narrow
 *
 * An owner is recorded only when the run had an identity to record. A `'public'`
 * agent resolves no subject by design — `admitAgentRequest` does not pay for one
 * when the policy is absent or `'public'` — so its approvals have no owner and
 * behave exactly as before. The check therefore only ever NARROWS who may
 * approve, and only where identity already exists. A rule that started refusing
 * on public agents would be a different feature wearing a bug fix's clothes.
 */

const OPTS = { timeoutMs: 50_000, onTimeout: 'abort' as const }

describe('the approval ledger records an owner (B-016)', () => {
  it('test_the_owner_can_be_read_back', () => {
    const registry = createInProcessApprovalRegistry()
    void registry.register('a1', { ...OPTS, owner: 'user-7' })

    expect(registry.ownerOf('a1')).toBe('user-7')
  })

  it('test_an_approval_registered_without_an_owner_reports_none', () => {
    // The public-agent path. `undefined` must be distinguishable from a real
    // owner, because the caller's rule branches on exactly that.
    const registry = createInProcessApprovalRegistry()
    void registry.register('a2', OPTS)

    expect(registry.ownerOf('a2')).toBeUndefined()
  })

  it('test_an_unknown_id_reports_none_rather_than_throwing', () => {
    // A settled or expired approval is indistinguishable from one that never
    // existed, and the caller treats both the same: nothing to compare against.
    const registry = createInProcessApprovalRegistry()

    expect(registry.ownerOf('never-registered')).toBeUndefined()
  })

  it('test_the_owner_is_gone_once_the_approval_settles', () => {
    const registry = createInProcessApprovalRegistry()
    void registry.register('a3', { ...OPTS, owner: 'user-7' })

    registry.resolve('a3', true)

    // Not bookkeeping: an id that outlived its approval and still names an owner
    // would let a later registration of the same id inherit it.
    expect(registry.ownerOf('a3')).toBeUndefined()
  })

  it('test_the_owner_is_not_exposed_through_the_listing', () => {
    // `list()` feeds a UI. Owner ids are identity, and a listing that carries
    // them tells every reader who else is waiting on this agent.
    const registry = createInProcessApprovalRegistry()
    void registry.register('a4', { ...OPTS, owner: 'user-7', toolName: 't', question: 'q' })

    expect(JSON.stringify(registry.list())).not.toContain('user-7')
  })
})

/**
 * The endpoint half. Recording an owner changes nothing observable on its own —
 * this is where the ledger becomes a refusal.
 */
describe('the approve endpoint refuses a caller who does not own the approval (B-016)', () => {
  const OWNER = { id: 'user-7' }
  const OTHER = { id: 'user-9' }

  function post(id: string): Request {
    return new Request(`https://app.example/api/agents/support/approve/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-theo-action': '1' },
      body: JSON.stringify({ approved: true }),
    })
  }

  it('test_the_owner_may_settle_their_own_approval', async () => {
    const registry = createInProcessApprovalRegistry()
    void registry.register('own-1', { ...OPTS, owner: OWNER.id })

    const res = await handleAgentApproval(
      post('own-1'),
      '/api/agents/support/approve/own-1',
      registry,
      'off',
      {
        policy: () => true,
        resolveSubject: () => OWNER,
      },
    )

    expect(res.status).toBe(200)
  })

  it('test_another_admitted_subject_is_refused', async () => {
    // The vulnerability in one sentence: both callers pass the agent's policy,
    // and before this only the policy stood between them.
    const registry = createInProcessApprovalRegistry()
    void registry.register('own-2', { ...OPTS, owner: OWNER.id })

    const res = await handleAgentApproval(
      post('own-2'),
      '/api/agents/support/approve/own-2',
      registry,
      'off',
      {
        policy: () => true,
        resolveSubject: () => OTHER,
      },
    )

    expect(res.status).toBe(403)
  })

  it('test_an_unowned_approval_is_settled_as_before', async () => {
    // The public-agent path. Nothing was recorded, so nothing is enforced — the
    // refusal must only ever narrow, never introduce a gate where none existed.
    const registry = createInProcessApprovalRegistry()
    void registry.register('own-3', OPTS)

    const res = await handleAgentApproval(
      post('own-3'),
      '/api/agents/support/approve/own-3',
      registry,
      'off',
      {
        policy: 'public',
      },
    )

    expect(res.status).toBe(200)
  })

  it('test_an_owned_approval_with_no_resolver_is_refused', async () => {
    // An owner exists and the caller cannot be identified: the safe answer is no.
    // Admitting here would make the check depend on the CALLER's configuration.
    const registry = createInProcessApprovalRegistry()
    void registry.register('own-4', { ...OPTS, owner: OWNER.id })

    const res = await handleAgentApproval(
      post('own-4'),
      '/api/agents/support/approve/own-4',
      registry,
      'off',
      {
        policy: () => true,
      },
    )

    expect(res.status).toBe(403)
  })
})
