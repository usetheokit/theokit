import { describe, expect, it } from 'vitest'

import { AgentBuilder } from '../../packages/agents/src/index.js'

import { mountAgent } from '../../packages/theo/src/server/agent/mount-agent.js'

/**
 * theokit#326 — the resolver can only honour the declared provider if it is told the model.
 *
 * `mountAgent` received an already-resolved `apiKey` string, chosen before the module was
 * compiled and therefore before anyone knew what model it declares. Accepting a resolver instead
 * lets the decision happen where the answer exists.
 */
function agentModule(model: string): unknown {
  return { default: AgentBuilder.create().model(model).system('probe').build() }
}

function post(body: unknown): Request {
  return new Request('http://localhost/api/agents/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Theo-Action': '1' },
    body: JSON.stringify(body),
  })
}

describe('mountAgent resolves the key from the agent it is about to run (theokit#326)', () => {
  it('passes the declared model to the resolver', async () => {
    const seen: (string | undefined)[] = []

    await mountAgent(agentModule('anthropic/claude-sonnet-4-6'), post({ message: 'hi' }), (m) => {
      seen.push(m)
      return 'sk-test'
    })

    expect(seen).toEqual(['anthropic/claude-sonnet-4-6'])
  })

  it('still accepts a plain key, so existing callers keep working', async () => {
    const response = await mountAgent(
      agentModule('gpt-4o-mini'),
      post({ message: 'hi' }),
      'sk-test',
    )

    expect(response.status).not.toBe(500)
  })
})
