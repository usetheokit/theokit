/**
 * A route `mountAgent` serves with its default CSRF mode admits the A2A tool.
 *
 * `theokit start` mounts every agent under strict CSRF, whose gate refuses a POST whose
 * `X-Theo-Action` is not `1`. The A2A tool is a server-to-server caller with no `Origin`, which the
 * strict gate accepts, so the one thing it has to send is the action header. This test mounts the
 * route with no options object, so the default is what runs.
 *
 * The LLM boundary is stubbed to echo, as in `agent-endpoints-refuse-an-unauthenticated-caller`;
 * everything between the tool and that stub is the real code.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../packages/agents/src/bridge/sdk-adapter.js', () => ({
  createSdkAgentStream:
    () =>
    (message: string): AsyncIterable<{ type: string; [k: string]: unknown }> => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'text_delta', content: `Echo: ${message}` }
        yield {
          type: 'done',
          result: `Echo: ${message}`,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          durationMs: 1,
        }
      },
    }),
}))

const { createA2ATool } = await import('../../packages/agents/src/a2a/a2a-client.js')
const { defineAgent } = await import('../../packages/agents/src/bridge/define-agent.js')
const { mountAgent } = await import('../../packages/theo/src/server/agent/mount-agent.js')

describe('a default agent route and the A2A client', () => {
  it('test_the_a2a_client_is_admitted_by_a_default_agent_route', async () => {
    const mod = {
      default: defineAgent({ model: 'anthropic/claude-sonnet-4-6', system: 'echo', tools: [] }),
      policy: 'public',
    }
    const tool = createA2ATool({
      url: 'https://remote.example/api/agents/remote',
      name: 'ask_remote',
      description: 'Ask the remote agent',
      fetchImpl: (url, init) => mountAgent(mod, new Request(url, init), 'sk-test'),
    })

    expect(await tool.handler({ message: 'hi' })).toBe('Echo: hi')
  })
})
