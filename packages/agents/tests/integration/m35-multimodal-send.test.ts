import { describe, expect, it, vi } from 'vitest'

// M35 (multimodal) — the adapter must send the SDK's structured `{ text, images }` form when images are
// present, and the plain string otherwise (back-compat). Capture the first arg handed to `agent.send`.
const sendArgs: unknown[] = []
vi.mock('@theokit/sdk', () => ({
  Agent: {
    getOrCreate: (_id: string, _opts: Record<string, unknown>) =>
      Promise.resolve({
        send: async (input: unknown) => {
          sendArgs.push(input)
          return { stream: async function* () {}, wait: async () => ({}) }
        },
        dispose: async () => {},
      }),
  },
  Tool: { create: (spec: unknown) => spec },
}))

import { createSdkAgentStream } from '../../src/bridge/sdk-adapter.js'

async function drain(factory: ReturnType<typeof createSdkAgentStream>): Promise<void> {
  for await (const _ of factory('hello', 'sess-1')) {
    /* consume */
  }
}

describe('M35 — adapter sends structured message when images are present', () => {
  it('sends { text, images } when images are supplied', async () => {
    sendArgs.length = 0
    const img = { data: 'aGVsbG8=', mimeType: 'image/png' }
    const factory = createSdkAgentStream({ tools: [] } as never, [], 'k', { images: [img] })
    await drain(factory)
    expect(sendArgs[0]).toEqual({ text: 'hello', images: [img] })
  })

  it('sends the plain string when no images are supplied (back-compat)', async () => {
    sendArgs.length = 0
    const factory = createSdkAgentStream({ tools: [] } as never, [], 'k', {})
    await drain(factory)
    expect(sendArgs[0]).toBe('hello')
  })
})
