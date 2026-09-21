import { describe, expect, it } from 'vitest'

import {
  createInProcessApprovalRegistry,
  type ApprovalRegistry,
} from '../../src/server/agent/approval-registry.js'
import { handleListApprovals } from '../../src/server/agent/list-approvals-handler.js'

/**
 * B-236. `getApprovalRegistry()` resolves a `processSingleton`, and every deploy target B-185 made
 * this listing reachable on is multi-instance by construction — a Worker is isolates, a Lambda is
 * concurrent invocations. So `200 {approvals: []}` was returned for an owner whose run paused on
 * ANOTHER instance, and that is indistinguishable from "nothing is pending".
 *
 * The empty case is the obvious half and not the whole of it: a listing of two can be two of five.
 * Every answer this registry gives is about one process, so every answer says so.
 *
 * The value is read from the REGISTRY rather than hardcoded in the handler. The registry interface
 * is injectable precisely so a durable implementation can replace the in-process one, and a
 * constant in the handler would become false on the day somebody does — which is the defect this
 * item is, one layer up. An implementation that declares nothing is treated as instance-scoped,
 * because that is the answer that cannot over-claim.
 */
const HOUR = 3_600_000

function seeded(): ApprovalRegistry {
  const registry = createInProcessApprovalRegistry()
  void registry.register('a-1', {
    timeoutMs: HOUR,
    onTimeout: 'abort',
    toolName: 'deploy',
    owner: 'alice',
  })
  return registry
}

async function body(response: Response): Promise<{ approvals: unknown[]; scope?: string }> {
  return (await response.json()) as { approvals: unknown[]; scope?: string }
}

describe('an approvals listing declares its scope (B-236)', () => {
  it('test_an_empty_listing_says_it_speaks_for_one_instance', async () => {
    const parsed = await body(handleListApprovals(createInProcessApprovalRegistry(), 'alice'))

    expect(parsed.approvals).toHaveLength(0)
    expect(
      parsed.scope,
      'an empty listing with no scope reads as "nothing is pending anywhere", which this ' +
        'registry cannot know — it holds one process',
    ).toBe('instance')
  })

  it('test_a_non_empty_listing_says_it_too', async () => {
    // The empty case is the one the item names and NOT the only one that misleads: two approvals
    // returned by one instance can be two of five. A scope declared only when the list is empty
    // would be a caveat that disappears exactly when the caller starts trusting the numbers.
    const parsed = await body(handleListApprovals(seeded(), 'alice'))

    expect(parsed.approvals).toHaveLength(1)
    expect(parsed.scope).toBe('instance')
  })

  it('test_a_registry_that_declares_a_wider_scope_is_reported_as_it_declares', async () => {
    // Nothing ships a shared registry today (YAGNI), and the point of reading the value rather
    // than writing it is that wiring one does not mean editing this handler. The registry below
    // stands in for that implementation.
    const shared: ApprovalRegistry = { ...createInProcessApprovalRegistry(), scope: 'shared' }

    expect((await body(handleListApprovals(shared, 'alice'))).scope).toBe('shared')
  })

  it('test_a_registry_that_declares_nothing_is_read_as_one_instance', async () => {
    // The fail-safe direction: an implementation predating this field must not be reported as
    // authoritative for a deployment. Silence is the narrow claim, never the wide one.
    const silent = { ...createInProcessApprovalRegistry(), scope: undefined } as ApprovalRegistry

    expect((await body(handleListApprovals(silent, 'alice'))).scope).toBe('instance')
  })
})
