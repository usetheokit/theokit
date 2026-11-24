import { describe, expect, it } from 'vitest'

import { AgentClient } from '../../src/client/agent-client.js'
import {
  InProcessTransport,
  type InProcessRunInput,
} from '../../src/client/in-process-transport.js'

interface TurnBody {
  message: string
  model?: string
}

describe('InProcessTransport forwards the send body', () => {
  it('hands the runner the object passed to send, per turn', async () => {
    const seen: InProcessRunInput<TurnBody>[] = []
    const transport = new InProcessTransport({
      // eslint-disable-next-line require-yield -- an empty turn
      run: async function* (input) {
        seen.push(input as InProcessRunInput<TurnBody>)
      },
    })
    const client = new AgentClient<TurnBody>(transport)
    await client.sendAndWait({ message: 'hi', model: 'm1' })
    await client.sendAndWait({ message: 'again' })
    expect(seen[0]?.message).toBe('hi')
    expect(seen[0]?.body?.model).toBe('m1')
    expect(seen[1]?.body?.model).toBeUndefined()
  })
})
