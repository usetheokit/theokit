import type { WireMessage } from '@theokit/presenter/wire'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { AgentClient } from '../../src/client/agent-client.js'
import { useAgent } from '../../src/client/use-agent.js'
import type { AgentTransport } from '../../src/client/transport.js'

const history: WireMessage[] = [
  { id: 'h1', role: 'user', parts: [{ type: 'text', text: 'earlier' }] },
  { id: 'h2', role: 'assistant', parts: [{ type: 'text', text: 'reply' }] },
]
const transport = {
  sendMessages: () => Promise.resolve(new ReadableStream({ start: (c) => c.close() })),
} as unknown as AgentTransport

describe('useAgent initialThread', () => {
  it('exposes the messages in thread before the first send', () => {
    let seen: WireMessage[] = []
    function Probe() {
      seen = useAgent(transport, { initialThread: history }).thread
      return null
    }
    renderToString(createElement(Probe))
    expect(seen).toEqual(history)
  })

  it('keeps the history after a send starts, and reset clears it', () => {
    const client = new AgentClient(transport, undefined, { initialThread: history })
    expect(client.getSnapshot().thread).toEqual(history)
    client.send({ message: 'next' })
    expect(client.getSnapshot().thread.slice(0, 2)).toEqual(history)
    client.reset()
    expect(client.getSnapshot().thread).toEqual([])
  })
})
