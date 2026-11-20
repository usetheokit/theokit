import { describe, expect, it, vi } from 'vitest'

import { withGuardrails } from '../../src/bridge/handle-wrappers.js'
import type { SdkMessage } from '../../src/bridge/event-translator.js'
import type { SdkAgentHandle } from '../../src/bridge/sdk-adapter.js'

describe('a structured user message under guardrails', () => {
  it('guards its text and forwards the other fields', async () => {
    const send = vi.fn(() =>
      Promise.resolve({
        wait: () => Promise.resolve({ status: 'finished', result: 'ok' }),
        stream: async function* () {},
        cancel: () => Promise.resolve(),
      }),
    )
    const handle: SdkAgentHandle<SdkMessage> = {
      agentId: 'a',
      dispose: () => Promise.resolve(),
      send,
    }
    const guarded = withGuardrails(handle, [
      { name: 'redact', checkInput: (t) => ({ action: 'redact', text: t.replace('SECRET', 'X') }) },
    ])
    const images = [{ data: 'abc', mimeType: 'image/png' }] as never
    await guarded.send({ text: 'a SECRET', images })
    expect(send).toHaveBeenCalledWith({ text: 'a X', images }, undefined)
  })
})
