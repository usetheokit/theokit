import { describe, it, expect } from 'vitest'

import { mountAgent } from '../../packages/theo/src/server/agent/mount-agent.js'
import { requireOwner } from '../../packages/theo/src/core/contracts/route-policy.js'
import type { RoutePolicyInput } from '../../packages/theo/src/core/contracts/route-policy.js'

/**
 * usetheokit/theokit#365 - the agent endpoint resumes any conversation by id with
 * no owner check. `mountAgent` is not a `route()`, so ADR 0001's policy seam - the
 * one both HTTP executors and `callProcedure` evaluate - never reached the surface
 * this framework exists for.
 *
 * The refusal happens BEFORE the module is compiled and before the SDK is
 * reached, for the same reason the CSRF gate above it does: an agent run spends
 * real tokens, so a caller who may not run it must be turned away before any of
 * that is paid for. That ordering is asserted, not assumed - a policy evaluated
 * after the run started would be a cost gate that costs.
 */

function agentModule(onCompile?: () => void) {
  return {
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

describe('the agent endpoint evaluates a policy (#365)', () => {
  it('test_a_caller_who_does_not_own_the_conversation_is_refused', async () => {
    const response = await mountAgent(agentModule(), chatRequest('conversation-of-user-a'), 'k', {
      subject: { id: 'user-b' },
      policy: ({ subject, body }: RoutePolicyInput) =>
        requireOwner(subject, ownerOfConversation((body as { sessionId: string }).sessionId)),
    })

    expect(response.status).toBe(403)
    expect(await response.text()).toContain('does not own')
  })

  it('test_the_owner_gets_past_the_policy', async () => {
    // The fixture is not a real agent, so the call fails at compile - which is
    // exactly the evidence wanted: reaching the compiler means the policy allowed.
    // Asserting `status !== 403` would also pass on an unrelated failure.
    await expect(
      mountAgent(agentModule(), chatRequest('conversation-of-user-a'), 'k', {
        subject: { id: 'user-a' },
        policy: ({ subject, body }: RoutePolicyInput) =>
          requireOwner(subject, ownerOfConversation((body as { sessionId: string }).sessionId)),
      }),
    ).rejects.toThrow(/must default-export/)
  })

  it('test_the_refusal_happens_before_the_agent_module_is_compiled', async () => {
    let compiled = false

    await mountAgent(
      agentModule(() => (compiled = true)),
      chatRequest('conversation-of-user-a'),
      'k',
      {
        subject: { id: 'user-b' },
        policy: () => false,
      },
    )

    // An agent run spends real tokens. A policy evaluated after the run began
    // would be a cost gate that costs.
    expect(compiled).toBe(false)
  })

  it('test_an_endpoint_with_no_declared_policy_behaves_as_it_did_before', async () => {
    // Absence is not reinterpreted as denial here, matching the route executors.
    // Same oracle as above: reaching the compiler is what proves nothing refused.
    await expect(mountAgent(agentModule(), chatRequest('anything'), 'k', {})).rejects.toThrow(
      /must default-export/,
    )
  })
})

/** Stand-in for whatever an application uses to answer 'who owns this conversation'. */
function ownerOfConversation(sessionId: string): string {
  return sessionId === 'conversation-of-user-a' ? 'user-a' : 'nobody'
}
