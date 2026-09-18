/**
 * The agent run endpoint hands the caller-supplied conversation id to the policy that guards it.
 *
 * ## Why this test and not a framework-side owner check
 *
 * `AgentAccessParams.sessionId` says it in its own words: *"the conversation key, when the request
 * names one. This is the value the durable store resumes on, and the reason #365 exists: it arrives
 * from the caller."* A framework cannot know tenancy — which subject owns which conversation is the
 * application's map — so the seam it can offer is to pass the id to the declared policy and let the
 * application refuse.
 *
 * That seam is what closes the draft advisory `GHSA-rr8g-67xc-5g4x` (unauthenticated cross-tenant
 * read: the endpoint resumes any conversation by caller-supplied id). It existed and **nothing held
 * it**: measured 2026-09-18, no test anywhere asserted that `params.sessionId` reaches a policy. A
 * refactor could have dropped it from the params object and every suite would have stayed green,
 * while the control an advisory was closed on quietly stopped being reachable.
 *
 * So the load-bearing assertion here is the POSITIVE one — the policy is asked, and asked about the
 * id the caller sent — with the refusal case beside it to show the answer is honoured.
 */
import { describe, expect, it } from 'vitest'

import { defineAgent } from '../../packages/agents/src/bridge/define-agent.js'
import { mountAgent } from '../../packages/theo/src/server/agent/mount-agent.js'

/** A CSRF-valid request carrying a conversation id the caller chose. */
function resumeRequest(sessionId: string): Request {
  return new Request('http://localhost/api/agents/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Theo-Action': '1' },
    body: JSON.stringify({ message: 'hello', sessionId }),
  })
}

describe('the policy guarding an agent is told which conversation is being resumed', () => {
  it('test_the_policy_RECEIVES_the_caller_supplied_conversation_id', async () => {
    const seen: unknown[] = []
    await mountAgent(
      {
        default: defineAgent({ model: 'm' }),
        policy: (input: { params?: { sessionId?: string } }) => {
          seen.push(input.params?.sessionId)
          return false
        },
      },
      resumeRequest('belongs-to-someone-else'),
      'k',
      { source: 'agents/echo.ts' },
    )

    expect(
      seen,
      'the policy was never asked, or was asked without the conversation id — either way an ' +
        'application cannot refuse a resume it cannot see',
    ).toEqual(['belongs-to-someone-else'])
  })

  it('test_a_policy_that_REFUSES_stops_the_resume', async () => {
    const response = await mountAgent(
      {
        default: defineAgent({ model: 'm' }),
        policy: (input: { params?: { sessionId?: string } }) => input.params?.sessionId === 'mine',
      },
      resumeRequest('belongs-to-someone-else'),
      'k',
      { source: 'agents/echo.ts' },
    )

    expect(response.status, 'a refused resume answered as if it were allowed').toBe(403)
  })
})
