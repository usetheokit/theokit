import { describe, expect, it } from 'vitest'

import { defineAgent } from '../../packages/agents/src/bridge/define-agent.js'

import { mountAgent } from '../../packages/theo/src/server/agent/mount-agent.js'

/**
 * B-237. `resolve-agent-subject.ts:69-72` states the guarantee in its own words: a `createContext`
 * that throws *"is not swallowed — an application whose identity resolution is broken must not be
 * treated as an anonymous caller, because that reads as a clean refusal and hides the fault"*.
 *
 * Nothing measured it. The sibling integration test drives a context module that throws at IMPORT
 * and is deliberately not this: there the module never loads, here it loads and the FACTORY throws
 * when called, which is the case the docblock is about.
 *
 * It lives under `tests/unit/` rather than `packages/theo/tests/` for a resolution reason, not a
 * taxonomic one: `@theokit/agents` does not resolve to the real module from the package's own test
 * project, and `defineAgent` came back undefined there. The suites that build valid agent modules
 * — `serve-aux-routes.test.ts`, `mcp-stdio.test.ts` — are all here, and all import
 * `defineAgent` from the SOURCE path rather than the package name, which is what resolves.
 *
 * It is tested at `mountAgent` rather than through an emitted deploy entry, and that is a choice
 * with a reason. The deploy-entry harness stubs `mountAgent` to a constant `Response` so it can
 * assert the SHAPE of generated code without a runtime; a status asserted through it would be the
 * stub's, not the framework's. `agent-access.ts:146` is where `resolveSubject()` is awaited, and
 * `mountAgent` is the nearest layer that owns a `Response`.
 *
 * Two fixture facts were measured rather than assumed, and both produced a false result first:
 *
 *   - **Without `x-theo-action` the CSRF gate answers 403 with the resolver called ZERO times.**
 *     That reads exactly like the defect under test — a refusal where identity was never
 *     consulted — and a test built on it would have reported a framework defect that is a missing
 *     header.
 *   - **A policy is `'public'` or a FUNCTION**, and an agent module must default-export a
 *     `defineAgent(...)` value. A first pass used `{ subject: { required: true } }` and a bare
 *     async function; both threw a constructor error that the test's own `try` swallowed into a
 *     "not 403, not 200" pass. Green, and measuring nothing.
 */
const GATED = {
  // `agent-access.ts:145` returns early for an undeclared policy and for `'public'`, so a policy
  // that READS the subject is what makes the resolver run at all.
  policy: ({ subject }: { subject: unknown }) => subject !== null,
  default: defineAgent({ model: 'claude-sonnet-4-6', tools: [] }),
}

const POLICY_FREE = { default: defineAgent({ model: 'claude-sonnet-4-6', tools: [] }) }

function run(): Request {
  return new Request('https://app.test/api/agents/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-theo-action': '1' },
    body: JSON.stringify({ message: 'hi' }),
  })
}

/** Mount `mod` with a resolver that throws, and report what came back plus whether it was called. */
async function mountWithBrokenIdentity(
  mod: unknown,
): Promise<{ status: number | 'threw'; calls: number }> {
  let calls = 0
  const resolveSubject = async (): Promise<never> => {
    calls += 1
    throw new Error('identity backend unreachable')
  }
  try {
    const response = await mountAgent(
      mod as never,
      run(),
      (() => 'sk-test') as never,
      {
        agentName: 'chat',
        resolveSubject: resolveSubject as never,
      } as never,
    )
    return { status: response.status, calls }
  } catch {
    // Propagating is a legitimate outcome: it is NOT an anonymous run and NOT a clean refusal,
    // which is the whole of what the docblock promises.
    return { status: 'threw', calls }
  }
}

describe('a throwing context factory is not an anonymous caller (B-237)', () => {
  it('test_a_broken_identity_is_not_served_as_a_clean_refusal_or_a_run', async () => {
    const { status, calls } = await mountWithBrokenIdentity(GATED)

    expect(calls, 'the resolver was never called, so this measures something else').toBe(1)
    expect(
      status,
      'a broken identity resolution was answered as a policy refusal, which reads as the policy ' +
        'working and hides the fault',
    ).not.toBe(403)
    expect(status, 'a broken identity resolution was served as a successful run').not.toBe(200)
  })

  it('test_an_agent_that_needs_no_identity_never_asks_for_one', async () => {
    // The control, and the reason the fixture above declares a policy at all. Without it the test
    // above would pass on a framework that consults identity for every agent, which would make a
    // broken `context.ts` take down agents that never needed it.
    const { calls } = await mountWithBrokenIdentity(POLICY_FREE)

    expect(calls, 'an agent declaring no policy paid for an identity it never asked for').toBe(0)
  })
})
