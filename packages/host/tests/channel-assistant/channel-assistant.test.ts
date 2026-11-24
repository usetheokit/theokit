import { BasePlatformAdapter } from '@theokit/gateway'
import type {
  GatewayHook,
  MessageEvent,
  OutboundMessage,
  PlatformName,
  SendResult,
} from '@theokit/gateway'
import type { SDKAgent } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { createChannelAssistant } from '../../src/channel-assistant/index.js'

class FakeAdapter extends BasePlatformAdapter {
  connects = 0
  disconnects = 0
  readonly sent: OutboundMessage[] = []
  #handler: ((event: MessageEvent) => Promise<void>) | undefined
  constructor(
    readonly platform: PlatformName,
    private readonly connectResult = true,
  ) {
    super()
  }
  async connect(): Promise<boolean> {
    this.connects += 1
    return this.connectResult
  }
  async disconnect(): Promise<void> {
    this.disconnects += 1
  }
  async sendMessage(message: OutboundMessage): Promise<SendResult> {
    this.sent.push(message)
    return { ok: true, messageId: `sent-${this.sent.length}` }
  }
  onInbound(handler: (event: MessageEvent) => Promise<void>): () => void {
    this.#handler = handler
    return () => {
      this.#handler = undefined
    }
  }
  deliver(event: MessageEvent): Promise<'ok' | 'no_handler' | 'handler_threw'> {
    return this.runHandler(this.#handler, event)
  }
}

function event(text: string, senderId = 'user-1'): MessageEvent {
  return {
    id: `m-${text}`,
    platform: 'telegram',
    sender: { id: senderId },
    channel: { id: 'chat-1', type: 'dm' },
    text,
    receivedAt: 0,
    telegram: { raw: null },
  } as unknown as MessageEvent
}

const SECRET = 'sk-very-secret-value'

function fakeAgent(disposed: string[]): SDKAgent {
  return {
    send: async () => ({
      stream: async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: `the key is ${SECRET}` }] },
        }
      },
      wait: async () => ({ status: 'finished' }),
    }),
    dispose: async () => {
      disposed.push('agent')
    },
  } as unknown as SDKAgent
}

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

describe('createChannelAssistant', () => {
  it('replies once with the secret masked, then disconnects and disposes the session agent on close', async () => {
    const adapter = new FakeAdapter('telegram')
    const disposed: string[] = []
    const assistant = createChannelAssistant({
      channels: [{ platform: 'telegram', build: () => adapter }],
      agent: () => fakeAgent(disposed),
      secrets: [SECRET],
    })
    await assistant.start()
    expect(adapter.connects).toBe(1)
    expect(await adapter.deliver(event('hello'))).toBe('ok')
    await until(() => adapter.sent.length > 0, 'the reply')
    expect(adapter.sent).toHaveLength(1)
    expect(JSON.stringify(adapter.sent[0])).not.toContain(SECRET)
    expect(assistant.sessions.heldIds()).toHaveLength(1)

    const result = await assistant.close()
    expect(result.ok).toBe(true)
    expect(adapter.disconnects).toBe(1)
    expect(disposed).toEqual(['agent'])
    await assistant.close()
    expect(adapter.disconnects).toBe(1)
  })

  it('runs the app hooks after the access policy and before help', async () => {
    const adapter = new FakeAdapter('telegram')
    const order: string[] = []
    const hook = (name: string): GatewayHook => ({
      name,
      pre_inbound: () => {
        order.push(name)
      },
    })
    const assistant = createChannelAssistant({
      channels: [{ platform: 'telegram', build: () => adapter }],
      agent: () => fakeAgent([]),
      preHooks: [hook('pre')],
      access: hook('access'),
      hooks: [hook('app-1'), hook('app-2')],
      help: hook('help'),
    })
    await assistant.start()
    await adapter.deliver(event('hi'))
    await until(() => order.length >= 5, 'every hook')
    expect(order).toEqual(['pre', 'access', 'app-1', 'app-2', 'help'])
    await assistant.close()
  })

  it('builds the access policy from options and refuses a stranger', async () => {
    const adapter = new FakeAdapter('telegram')
    const assistant = createChannelAssistant({
      channels: [{ platform: 'telegram', build: () => adapter }],
      agent: () => fakeAgent([]),
      access: { owners: new Set(['telegram:boss']), dm: 'allowlist', isAuthenticated: () => true },
    })
    await assistant.start()
    await adapter.deliver(event('hi', 'stranger'))
    expect(assistant.sessions.heldIds()).toHaveLength(0)
    await assistant.close()
  })

  it('leaves out a platform that fails to build and keeps the rest', async () => {
    const adapter = new FakeAdapter('telegram')
    const lines: string[] = []
    const assistant = createChannelAssistant({
      channels: [
        {
          platform: 'discord',
          build: () => {
            throw new Error(`bad token ${SECRET}`)
          },
        },
        { platform: 'telegram', build: () => adapter },
      ],
      agent: () => fakeAgent([]),
      secrets: [SECRET],
      write: (line) => lines.push(line),
    })
    await assistant.start()
    expect(assistant.failed).toEqual(['discord'])
    expect(assistant.started.has('telegram')).toBe(true)
    expect(lines.join('\n')).not.toContain(SECRET)
    await assistant.close()
  })

  it('runs an event on one fresh agent and disposes it', async () => {
    const disposed: string[] = []
    const assistant = createChannelAssistant({
      channels: [],
      agent: () => fakeAgent([]),
      events: {
        agent: () =>
          ({
            send: async () => ({ stream: async function* () {} }),
            dispose: () => {
              disposed.push('event')
            },
          }) as never,
      },
    })
    await assistant.withEventAgent(async () => 'done')
    expect(disposed).toEqual(['event'])
    await assistant.close()
  })
})
