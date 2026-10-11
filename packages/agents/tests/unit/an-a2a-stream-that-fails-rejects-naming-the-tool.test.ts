/**
 * A stream that fails, or stops before it finishes, rejects the A2A tool call naming the tool.
 *
 * A remote agent can answer 200 and still not deliver an answer: the run throws after some text has
 * streamed (the route turns that into an `error` frame and then `finish`), or the connection drops
 * before the terminal `finish` frame. Returning the partial text in either case would hand the
 * calling model half an answer dressed as a whole one.
 */
import { describe, expect, it } from 'vitest'

import { createA2ATool } from '../../src/a2a/a2a-client.js'
import type { CompiledAgentOptions } from '../../src/bridge/agent-compiler.js'
import { generateAgentRoutes } from '../../src/bridge/agent-route-generator.js'
import type { StreamEvent } from '../../src/bridge/agent-sse-handler.js'

async function* runThatThrowsAfterText(): AsyncGenerator<StreamEvent> {
  yield { type: 'text_delta', content: 'remote ' }
  throw new Error('provider exploded')
}

function frame(chunk: unknown): string {
  return `data: ${JSON.stringify(chunk)}\n\n`
}

describe('an A2A stream that fails rejects naming the tool', () => {
  it('test_an_error_frame_after_text_rejects_naming_the_tool', async () => {
    const routes = generateAgentRoutes({
      walkResult: { route: '/api/agents/remote' },
      compiledOptions: {} as CompiledAgentOptions,
      createRun: () => runThatThrowsAfterText(),
    })
    const chat = routes.find((r) => r.method === 'POST')
    if (chat === undefined) throw new Error('generateAgentRoutes mounted no POST route')
    const tool = createA2ATool({
      url: `https://remote.example${chat.path}`,
      name: 'ask_remote',
      description: 'Ask the remote agent',
      fetchImpl: (url, init) => chat.handler(new Request(url, init)),
    })

    await expect(tool.handler({ message: 'hi' })).rejects.toThrow(/ask_remote.*An error occurred\./)
  })

  it('test_a_stream_cut_before_finish_rejects_naming_the_tool', async () => {
    const body =
      frame({ type: 'start' }) + frame({ type: 'text-delta', id: 't1', delta: 'remote ' })
    const tool = createA2ATool({
      url: 'https://remote.example/api/agents/remote/chat',
      name: 'ask_remote',
      description: 'Ask the remote agent',
      fetchImpl: () =>
        Promise.resolve(
          new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
        ),
    })

    await expect(tool.handler({ message: 'hi' })).rejects.toThrow(/ask_remote.*finish.*2 chunks/)
  })
})
