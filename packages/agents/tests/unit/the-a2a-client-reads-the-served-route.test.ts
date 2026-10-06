/**
 * The A2A client must read the answer the served agent route actually gives.
 *
 * `createA2ATool` POSTs `{ message }` and reads the response with `res.json()`. Every agent route
 * this framework serves answers that POST with an SSE stream of UIMessage wire chunks
 * (`streamAgentResponse` here, `durableUiMessageStreamResponse` in `@theokit/theo`), so the client
 * fails on the first byte of a real reply. The existing client tests never saw it because their
 * fake remote answers JSON, a shape no served route produces.
 *
 * This test puts the client in front of the route `generateAgentRoutes` mounts, in process, with a
 * scripted run, so the only thing under test is whether the two ends speak the same wire.
 */
import { describe, expect, it } from 'vitest'

import { createA2ATool } from '../../src/a2a/a2a-client.js'
import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'
import { generateAgentRoutes } from '../../src/bridge/agent-route-generator.js'
import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'

async function* scriptedRun(): AsyncGenerator<StreamEvent> {
  yield { type: 'text_delta', content: 'remote ' }
  yield { type: 'text_delta', content: 'says hi' }
}

describe('the A2A client reads the served agent route', () => {
  it('test_the_a2a_client_reads_the_served_route', async () => {
    const routes = generateAgentRoutes({
      walkResult: { route: '/api/agents/remote' },
      compiledOptions: {} as CompiledAgentOptions,
      createRun: () => scriptedRun(),
    })
    const chat = routes.find((r) => r.method === 'POST')
    if (chat === undefined) throw new Error('generateAgentRoutes mounted no POST route')

    const tool = createA2ATool({
      url: `https://remote.example${chat.path}`,
      name: 'ask_remote',
      description: 'Ask the remote agent',
      fetchImpl: (url, init) => chat.handler(new Request(url, init)),
    })

    const answer = await tool.handler({ message: 'hello' })

    expect(answer).toBe('remote says hi')
  })
})
