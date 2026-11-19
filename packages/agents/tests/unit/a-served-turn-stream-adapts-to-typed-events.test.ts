/**
 * The served turn speaks the SDK's message vocabulary (ACP dispatches exhaustively on it);
 * `withTypedStream` is the boundary that turns it into `AgentStreamEvent`s for the typed contract.
 */
import { describe, expect, it } from 'vitest'

import type { AgentStreamEvent } from '../../src/bridge/agent-stream-events.js'
import type { SdkMessage } from '../../src/bridge/event-translator.js'
import { withTypedStream } from '../../src/bridge/handle-wrappers.js'
import type { SdkAgentHandle, SdkTurnHandle } from '../../src/bridge/sdk-adapter.js'

const MESSAGES: SdkMessage[] = [
  { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } },
  { type: 'tool_call', agent_id: 'a', run_id: 'r1', call_id: 'c1', name: 'ls', status: 'running' },
  { type: 'status', agent_id: 'a', run_id: 'r1', status: 'ERROR', message: 'boom' },
  { type: 'user', agent_id: 'a', run_id: 'r1', message: { role: 'user', content: [] } },
]

function served(): SdkAgentHandle<SdkMessage> {
  return {
    agentId: 'agent-1',
    dispose: () => Promise.resolve(),
    send: () =>
      Promise.resolve({
        wait: () => Promise.resolve({ result: 'ok', status: 'finished' }),

        stream: async function* () {
          yield* MESSAGES
        },
      }),
  }
}

function streamOf(turn: SdkTurnHandle): AsyncIterable<AgentStreamEvent> {
  if (turn.stream === undefined) throw new Error('the turn has no stream()')
  return turn.stream()
}

async function collect(stream: AsyncIterable<AgentStreamEvent>): Promise<AgentStreamEvent[]> {
  const out: AgentStreamEvent[] = []
  for await (const e of stream) out.push(e)
  return out
}

describe('withTypedStream', () => {
  it('translates each served message to typed events and drops what has no equivalent', async () => {
    const turn = await withTypedStream(served()).send('go')
    const events = await collect(streamOf(turn))
    expect(events).toEqual([
      { type: 'text_delta', content: 'hi' },
      { type: 'tool_call', callId: 'c1', toolName: 'ls', input: {} },
      { type: 'error', code: 'AGENT_ERROR', message: 'boom', retryable: false },
    ])
  })

  it('leaves the served handle untouched: ACP still reads SDK messages', async () => {
    const handle = served()
    withTypedStream(handle)
    const turn = await handle.send('go')
    const raw: SdkMessage[] = []
    for await (const m of turn.stream?.() ?? []) raw.push(m)
    expect(raw).toEqual(MESSAGES)
  })

  it('forwards wait, agentId and dispose', async () => {
    const typed = withTypedStream(served())
    expect(typed.agentId).toBe('agent-1')
    expect(await (await typed.send('go')).wait()).toEqual({ result: 'ok', status: 'finished' })
    await expect(typed.dispose()).resolves.toBeUndefined()
  })

  it('has no stream when the served turn has none', async () => {
    const handle = served()
    const bare: SdkAgentHandle<SdkMessage> = {
      ...handle,
      send: () => Promise.resolve({ wait: () => Promise.resolve({}) }),
    }
    expect((await withTypedStream(bare).send('go')).stream).toBeUndefined()
  })
})
