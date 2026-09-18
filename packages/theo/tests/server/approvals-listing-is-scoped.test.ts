import { describe, expect, it } from 'vitest'

import {
  createInProcessApprovalRegistry,
  type ApprovalRegistry,
} from '../../src/server/agent/approval-registry.js'
import { handleListApprovals } from '../../src/server/agent/list-approvals-handler.js'

/**
 * `GET /api/agents/<name>/approvals` shows a caller the approvals that are theirs.
 *
 * ## What was already closed, and what was not
 *
 * The draft advisory `GHSA-g94h-459g-rjhj` describes two steps: list every pending approval without
 * authentication, then settle one with the id that listing hands you. The route closed the first
 * half (usetheokit/theokit#365 — `admitAux` refuses a caller the agent's policy does not admit) and
 * `approve-agent.ts` closed the settle half (B-016 — `refuseIfNotOwner` reads `registry.ownerOf`).
 *
 * The listing itself was never scoped. `handleListApprovals(registry)` returned `registry.list()`,
 * and that list is process-wide by contract (ADR 0038): one admitted tenant of one agent saw every
 * pending approval in the process, including other tenants' and other agents', with the `approvalId`
 * each one needs. The gate on the door was fixed while the window stayed open.
 *
 * ## Why `owner === undefined` stays visible
 *
 * The registry records an owner only for agents that DECLARE a policy; `'public'` and undeclared
 * record none, because `admitAgentRequest` does not resolve a subject for them and there is nothing
 * to attribute. `approve-agent.ts` already treats an absent owner as "nothing to compare a caller
 * against" and refuses nobody on it. Listing follows the same rule rather than inventing a second
 * one: hiding an ownerless approval would make a public agent's own UI blank.
 */

const HOUR = 3_600_000

/** A registry holding three pending approvals: two owned, one public. */
function seeded(): ApprovalRegistry {
  const registry = createInProcessApprovalRegistry()
  // `register` returns a Promise that settles later; nothing here awaits it.
  void registry.register('a-1', {
    timeoutMs: HOUR,
    onTimeout: 'abort',
    toolName: 'deploy',
    owner: 'alice',
  })
  void registry.register('b-1', {
    timeoutMs: HOUR,
    onTimeout: 'abort',
    toolName: 'refund',
    owner: 'bob',
  })
  void registry.register('p-1', { timeoutMs: HOUR, onTimeout: 'abort', toolName: 'search' })
  return registry
}

async function listedIds(response: Response): Promise<string[]> {
  const body = (await response.json()) as { approvals: { approvalId: string }[] }
  return body.approvals.map((a) => a.approvalId).sort((x, y) => x.localeCompare(y))
}

describe('the approvals listing is scoped to the caller', () => {
  it('test_the_registry_really_holds_all_three', async () => {
    // COUNTERPROOF for the fixture. A registry that silently held nothing would make every
    // assertion below pass over an empty list — green for the one reason that must never read green.
    const held = seeded()
      .list()
      .map((a) => a.approvalId)
      .sort((x, y) => x.localeCompare(y))
    expect(held).toEqual(['a-1', 'b-1', 'p-1'])
  })

  it('test_an_owner_does_NOT_see_another_owners_pending_approval', async () => {
    const ids = await listedIds(handleListApprovals(seeded(), 'alice'))
    expect(
      ids,
      "bob's approval id was handed to alice, and the id is all the settle route needs",
    ).not.toContain('b-1')
  })

  it('test_an_owner_DOES_see_their_own', async () => {
    // The load-bearing positive case. A filter that returned nothing would satisfy the test above
    // and break the feature — the near-miss `authenticated-guard.test.ts` records for a guard.
    expect(await listedIds(handleListApprovals(seeded(), 'alice'))).toContain('a-1')
  })

  it('test_an_ownerless_approval_stays_visible', async () => {
    // A public agent records no owner. Hiding those would blank its own approvals UI, and the
    // settle route already refuses nobody on an absent owner.
    expect(await listedIds(handleListApprovals(seeded(), 'alice'))).toContain('p-1')
  })

  it('test_a_caller_with_no_subject_sees_only_the_ownerless_ones', async () => {
    // `resolveSubject` is undefined when the agent declares no policy, and an undeclared agent
    // registers no owner — so this is the shape where the listing is legitimately unfiltered, and
    // it must still not surface an approval that DOES belong to someone.
    expect(await listedIds(handleListApprovals(seeded(), undefined))).toEqual(['p-1'])
  })
})
