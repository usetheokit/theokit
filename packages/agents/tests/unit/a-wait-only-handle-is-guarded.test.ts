import { describe, expect, it } from 'vitest'

import { withGuardrails } from '../../src/bridge/handle-wrappers.js'
import type { SdkMessage } from '../../src/bridge/event-translator.js'
import type { SdkAgentHandle } from '../../src/bridge/sdk-adapter.js'

/** A handle whose turn implements only `wait()`: no `stream`, no `cancel`. */
const waitOnly: SdkAgentHandle<SdkMessage> = {
  agentId: 'wait-only',
  dispose: () => Promise.resolve(),
  send: () =>
    Promise.resolve({ wait: () => Promise.resolve({ status: 'finished', result: 'a BANANA' }) }),
}

describe('a wait-only handle under guardrails', () => {
  it('is guarded and streamed without calling a stream it lacks', async () => {
    const handle = withGuardrails(waitOnly, [
      {
        name: 'redact',
        checkOutput: (t) => ({ action: 'redact', text: t.replace('BANANA', 'X') }),
      },
    ])
    const turn = await handle.send('hi')

    const events: unknown[] = []
    for await (const e of turn.stream?.() ?? []) events.push(e)

    expect(events).toEqual([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'a X' }] } },
    ])
    expect(turn.cancel).toBeUndefined()
  })
})
