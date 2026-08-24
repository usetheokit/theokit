import { describe, it, expect } from 'vitest'

import { mountAgent } from '../../packages/theo/src/server/agent/mount-agent.js'
import { AgentPolicyTypeError } from '../../packages/theo/src/server/agent/agent-access.js'
import { requireOwner } from '../../packages/theo/src/core/contracts/route-policy.js'
import type { RoutePolicyInput } from '../../packages/theo/src/core/contracts/route-policy.js'

/**
 * usetheokit/theokit#365 - the agent endpoint resumes any conversation by id with
 * no owner check. `mountAgent` is not a `route()`, so ADR 0001's policy seam - the
 * one both HTTP executors and `callProcedure` evaluate - never reached the surface
 * this framework exists for.
 *
 * The refusal happens BEFORE the module is compiled and long before the SDK is
 * reached, for the same reason the CSRF gate above it does: an agent run spends
 * real tokens, so a caller who may not run it must be turned away before any of
 * that is paid for. That ordering is asserted, not assumed.
 *
 * The policy is read from the MODULE, not from the call. That is the half this file
 * once could not test, because `mountAgent` took a `policy` option and every
 * production caller omitted it: the gate worked and was never reached. Reachability
 * is proved over a real listener in
 * `tests/integration/agent-endpoints-refuse-an-unauthenticated-caller.test.ts`; what
 * is proved here is the decision itself.
 */

function agentModule(policy: unknown, onCompile?: () => void) {
  return {
    ...(policy === undefined ? {} : { policy }),
    default: {
      __theoAgent: true,
      get model() {
        onCompile?.()
        return 'openai/gpt-4o-mini'
      },
    },
  }
}

function chatRequest(sessionId: string): Request {
  return new Request('http://localhost/api/agents/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-theo-action': '1' },
    body: JSON.stringify({ message: 'hi', sessionId }),
  })
}

/** The owner check an application writes, over the key the request supplies. */
const ownerPolicy = ({ subject, body }: RoutePolicyInput) =>
  requireOwner(subject, ownerOfConversation((body as { sessionId: string }).sessionId))

describe('the agent endpoint evaluates the policy its module declares (#365)', () => {
  it('test_a_caller_who_does_not_own_the_conversation_is_refused', async () => {
    const response = await mountAgent(
      agentModule(ownerPolicy),
      chatRequest('conversation-of-user-a'),
      'k',
      { agentName: 'chat', resolveSubject: () => ({ id: 'user-b' }) },
    )

    expect(response.status).toBe(403)
  })

  it('test_the_refusal_does_not_reveal_whether_the_conversation_exists', async () => {
    // `requireOwner` answers 'resource has no recorded owner' for an id nobody owns and
    // 'subject does not own this resource' for one somebody does. Echoed to the wire, that pair is
    // an enumeration oracle built out of the very check added to close the leak - and criterion 2
    // of the tenant journey forbids exactly that. Both refusals must read identically.
    const known = await mountAgent(
      agentModule(ownerPolicy),
      chatRequest('conversation-of-user-a'),
      'k',
      { agentName: 'chat', resolveSubject: () => ({ id: 'user-b' }) },
    )
    const unknown = await mountAgent(
      agentModule(ownerPolicy),
      chatRequest('no-such-conversation'),
      'k',
      { agentName: 'chat', resolveSubject: () => ({ id: 'user-b' }) },
    )

    expect(known.status).toBe(unknown.status)
    expect(await known.text()).toBe(await unknown.text())
  })

  it('test_the_owner_gets_past_the_policy', async () => {
    // The fixture is not a real agent, so the call fails at compile - which is
    // exactly the evidence wanted: reaching the compiler means the policy allowed.
    // Asserting `status !== 403` would also pass on an unrelated failure.
    await expect(
      mountAgent(agentModule(ownerPolicy), chatRequest('conversation-of-user-a'), 'k', {
        agentName: 'chat',
        resolveSubject: () => ({ id: 'user-a' }),
      }),
    ).rejects.toThrow(/must default-export/)
  })

  it('test_the_refusal_happens_before_the_agent_module_is_compiled', async () => {
    let compiled = false

    await mountAgent(
      agentModule(
        () => false,
        () => (compiled = true),
      ),
      chatRequest('conversation-of-user-a'),
      'k',
      { agentName: 'chat', resolveSubject: () => ({ id: 'user-b' }) },
    )

    // An agent run spends real tokens. A policy evaluated after the run began
    // would be a cost gate that costs.
    expect(compiled).toBe(false)
  })

  it('test_a_public_declaration_never_asks_who_is_calling', async () => {
    // `'public'` is a decision, and taking it must not cost the application's `createContext`.
    let asked = false

    await expect(
      mountAgent(agentModule('public'), chatRequest('anything'), 'k', {
        agentName: 'chat',
        resolveSubject: () => {
          asked = true
          return null
        },
      }),
    ).rejects.toThrow(/must default-export/)

    expect(asked).toBe(false)
  })

  it('test_an_explicit_policy_option_overrides_the_module_declaration', async () => {
    // The escape hatch for a host that already took the decision (an @Expose controller, an
    // embedder). Without it, a module declaring 'public' could not be re-gated by its host.
    const response = await mountAgent(agentModule('public'), chatRequest('anything'), 'k', {
      agentName: 'chat',
      policy: () => false,
      resolveSubject: () => null,
    })

    expect(response.status).toBe(403)
  })

  it('test_a_policy_export_of_the_wrong_type_fails_fast_naming_the_agent', async () => {
    // A module that MEANT to declare a policy and got the type wrong must not be served wide
    // open - that is the failure class this change exists to remove.
    await expect(
      mountAgent(agentModule(true), chatRequest('anything'), 'k', { agentName: 'chat' }),
    ).rejects.toThrow(AgentPolicyTypeError)
  })

  it('test_an_endpoint_with_no_declared_policy_behaves_as_it_did_before', async () => {
    // Absence is not reinterpreted as denial here, matching the route executors: a module handed
    // to `mountAgent` in memory never passed a scanner. Absence is refused at scan time, where the
    // file that omitted it can be named. Same oracle as above: reaching the compiler is what
    // proves nothing refused.
    await expect(
      mountAgent(agentModule(undefined), chatRequest('anything'), 'k', {}),
    ).rejects.toThrow(/must default-export/)
  })
})

/** Stand-in for whatever an application uses to answer 'who owns this conversation'. */
function ownerOfConversation(sessionId: string): string | null {
  return sessionId === 'conversation-of-user-a' ? 'user-a' : null
}
