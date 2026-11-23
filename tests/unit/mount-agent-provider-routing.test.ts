import { describe, expect, it, vi } from 'vitest'

import { AgentBuilder } from '../../packages/agents/src/index.js'

import { mountAgent } from '../../packages/theo/src/server/agent/mount-agent.js'
import {
  resetProviderAnnouncements,
  resolveProvider,
} from '../../packages/theo/src/server/agent/provider-resolver.js'

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

  it('mounts a local model with no cloud credential anywhere (#407)', async () => {
    // The real resolver, not a stub — the unit test proves `resolveProvider` returns an empty key
    // for a keyless provider, and this proves the mount path accepts one. Between the two sat the
    // actual question: whether some guard downstream rejects '' and turns the fix into a different
    // 500. (`requireApiKey` in agents/bridge/agent-orchestrator.ts does exactly that, but only on
    // the DELEGATION path — a local model that delegates to a sub-agent is still refused.)
    // `vi.stubEnv(k, undefined)` removes the variable and restores it on unstub — no manual
    // save/restore, and no dynamic delete over process.env.
    for (const k of ['OPENROUTER_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY']) {
      vi.stubEnv(k, undefined)
    }
    resetProviderAnnouncements()

    try {
      const response = await mountAgent(
        agentModule('ollama/llama3.2'),
        post({ message: 'hi' }),
        (m) => resolveProvider(m, { announce: () => undefined }).apiKey,
      )

      // Reaching ollama is not asserted — nothing is listening in CI, and that failure would be
      // the SDK's to report. What must not appear is the provider-resolution refusal, which named
      // three cloud variables and a payment page for a model on the developer's own machine.
      const body = await response.text()
      expect(body).not.toContain('No LLM provider API key found')
      expect(body).not.toContain('openrouter.ai/keys')
    } finally {
      vi.unstubAllEnvs()
      resetProviderAnnouncements()
    }
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
