import { beforeEach, describe, expect, it, vi } from 'vitest'

const seen = vi.hoisted(() => ({ build: [] as unknown[], stream: [] as unknown[] }))

vi.mock('@theokit/agents', () => ({
  streamAgentTurnInProcess: async function* (_m: unknown, _k: unknown, input: unknown) {
    seen.stream.push(input)
    await Promise.resolve()
    yield { type: 'finish' }
  },
}))
vi.mock('@theocode/agent', () => ({
  buildChatAgent: (o: unknown) => {
    seen.build.push(o)
    return Promise.resolve({})
  },
}))
vi.mock('@theocode/agent/config', () => ({
  resolveEffectiveConfig: () => ({ model: 'cfg-model', reasoning_effort: 'low' }),
}))
vi.mock('@theocode/agent/auth', () => ({
  resolveCredentialForModel: () => Promise.resolve({ apiKey: 'k' }),
  routeToCredential: (_c: unknown, m: string) => m,
}))

import { createChatTransport } from '../../src/agent-session/chat-transport.js'

async function turn(body?: Record<string, unknown>) {
  const t = createChatTransport({
    getSessionId: () => 's',
    getSessionPty: () => ({}) as never,
    credential: () => ({}) as never,
  })
  const stream = await t.sendMessages({
    messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    abortSignal: undefined,
    ...(body === undefined ? {} : { body }),
  } as never)
  await stream.getReader().read()
}

describe('chat transport reads the turn body', () => {
  beforeEach(() => {
    seen.build.length = 0
    seen.stream.length = 0
  })

  it('uses the body model, effort and images for that turn only', async () => {
    const images = [{ mediaType: 'image/png', data: 'x' }]
    await turn({ message: 'hi', model: 'm1', effort: 'high', images })
    await turn({ message: 'again' })
    const [first, second] = seen.build as { model?: string; reasoning_effort?: string }[]
    expect(first).toMatchObject({ model: 'm1', reasoning_effort: 'high' })
    expect(second).toMatchObject({ model: 'cfg-model', reasoning_effort: 'low' })
    const [s1, s2] = seen.stream as { images?: unknown; body?: unknown }[]
    expect(s1?.images).toEqual(images)
    expect(s2?.images).toBeUndefined()
    expect(s1?.body).toBeUndefined()
  })
})
