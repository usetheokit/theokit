import { describe, expect, it } from 'vitest'

import { serveMatchedAuxRoute } from '../../src/server/agent/serve-aux-routes.js'
import { getApprovalRegistry } from '../../src/server/agent/approval-registry.js'

/**
 * The approvals ROUTE hands the listing the caller it admitted — and asks for no caller it does not
 * need.
 *
 * `approvals-listing-is-scoped.test.ts` proves the filter. This proves the wiring, which is the half
 * a unit test of the handler cannot reach: the route could filter correctly against a subject it
 * never resolves, and the endpoint would then show every caller only the ownerless approvals.
 *
 * ## The second test is the one that was nearly broken
 *
 * `resolveSubject`'s own docblock states the contract: it runs ONLY when the matched path's agent
 * declares a policy, so the application's `createContext` never runs for a url this dispatcher
 * merely declines. The first version of the scoping resolved it unconditionally in this branch, and
 * nothing would have failed — the listing would have been right and an application's context
 * factory would have started running on requests it had never seen before.
 */

const HOUR = 3_600_000
const AGENT = { name: 'triage', filePath: '/agents/triage.ts', agentPath: '/api/agents/triage' }

/**
 * One owned approval and one ownerless, in the PROCESS registry — which is what the route reads.
 *
 * The module's own guidance is that tests use `createInProcessApprovalRegistry` and never the
 * singleton, and it is right for a unit test of the registry. A route test cannot follow it: the
 * route calls `getApprovalRegistry()`, and a registry the route does not read proves nothing about
 * the route. Registered once, with ids nothing else uses.
 */
let seeded = false
function install(): void {
  if (seeded) return
  const registry = getApprovalRegistry()
  void registry.register('owned', { timeoutMs: HOUR, onTimeout: 'abort', owner: 'alice' })
  void registry.register('free', { timeoutMs: HOUR, onTimeout: 'abort' })
  seeded = true
}

async function ids(response: Response): Promise<string[]> {
  const body = (await response.json()) as { approvals: { approvalId: string }[] }
  return body.approvals.map((a) => a.approvalId).sort((x, y) => x.localeCompare(y))
}

describe('the approvals route scopes to its admitted caller', () => {
  it('test_a_declared_policy_scopes_the_listing_to_the_admitted_subject', async () => {
    install()
    let asked = 0
    const response = await serveMatchedAuxRoute(
      { kind: 'approvals', agent: AGENT },
      new Request('http://localhost/api/agents/triage/approvals'),
      {
        loadModule: async () => ({ policy: () => true }),
        resolveSubject: () => {
          asked += 1
          return { id: 'alice' }
        },
        baseUrl: 'http://localhost',
      } as never,
    )

    expect(asked, 'the route did not ask who was calling, so any scoping is against nothing').toBe(
      1,
    )
    expect(await ids(response)).toEqual(['free', 'owned'])
  })

  it('test_an_UNDECLARED_agent_never_asks_who_is_calling', async () => {
    install()
    let asked = 0
    const response = await serveMatchedAuxRoute(
      { kind: 'approvals', agent: AGENT },
      new Request('http://localhost/api/agents/triage/approvals'),
      {
        loadModule: async () => ({}),
        resolveSubject: () => {
          asked += 1
          return { id: 'alice' }
        },
        baseUrl: 'http://localhost',
      } as never,
    )

    expect(
      asked,
      "the agent declares no policy, so the application's context factory must not run for it",
    ).toBe(0)
    expect(
      await ids(response),
      'an owned approval was shown to a caller nobody identified',
    ).toEqual(['free'])
  })
})
