/**
 * A static `X-Theo-Action` override still reaches a default agent route, which refuses it.
 *
 * The A2A tool sends `X-Theo-Action: 1` by default and lets a configured static header replace it
 * (`Headers.set`, case-insensitive). A caller who sets the header to `0` has opted out of admission,
 * and the route's strict CSRF gate must see that one value and answer 403, which the tool reports
 * naming itself and the status. The route is mounted with no options object, so its default runs.
 *
 * The LLM boundary is stubbed to echo, as in `agent-endpoints-refuse-an-unauthenticated-caller`.
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

describe('a default agent route and a static action override', () => {
  it('test_a_static_action_override_is_refused_by_a_default_agent_route', async () => {
    const mod = {
      default: defineAgent({ model: 'anthropic/claude-sonnet-4-6', system: 'echo', tools: [] }),
      policy: 'public',
    }
    const tool = createA2ATool({
      url: 'https://remote.example/api/agents/remote',
      name: 'ask_remote',
      description: 'Ask the remote agent',
      headers: { 'X-Theo-Action': '0' },
      fetchImpl: (url, init) => mountAgent(mod, new Request(url, init), 'sk-test'),
    })

    await expect(tool.handler({ message: 'hi' })).rejects.toThrow(/ask_remote.*403/)
  })
})
