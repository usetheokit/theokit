import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BasePlatformAdapter, maskSecrets } from '@theokit/gateway'
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
import type { ReplyHandlerFactory } from '../../src/channel-assistant/index.js'

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

/** A reply handler over the leased agent: sends one turn, masks the answer, sends it, releases the lease. */
const replyOver =
  (adapter: FakeAdapter): ReplyHandlerFactory =>
  ({ agentFor, secrets }) =>
  async (incoming) => {
    const lease = await agentFor(incoming)
    try {
      const run = (await lease.agent.send(incoming.text)) as {
        stream(): AsyncIterable<{ message: { content: { text: string }[] } }>
      }
      let text = ''
      for await (const part of run.stream()) text += part.message.content[0]?.text ?? ''
      await adapter.sendMessage({ text: maskSecrets(text, secrets) } as unknown as OutboundMessage)
    } finally {
      await lease.release()
    }
  }

async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 5000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setImmediate(resolve))
  }
}

const openHook: GatewayHook = { name: 'open', pre_inbound: () => undefined }

describe('createChannelAssistant', () => {
  it('replies once with the secret masked, then disconnects and disposes the session agent on close', async () => {
    const adapter = new FakeAdapter('telegram')
    const disposed: string[] = []
    const assistant = createChannelAssistant({
      channels: [{ platform: 'telegram', build: () => adapter }],
      sessions: { agent: () => fakeAgent(disposed) },
      replyHandler: replyOver(adapter),
      secrets: [SECRET],
      accessHook: openHook,
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
      sessions: { agent: () => fakeAgent([]) },
      replyHandler: replyOver(adapter),
      preHooks: [hook('pre')],
      accessHook: hook('access'),
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
      sessions: { agent: () => fakeAgent([]) },
      replyHandler: replyOver(adapter),
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
      sessions: { agent: () => fakeAgent([]) },
      replyHandler: replyOver(adapter),
      secrets: [SECRET],
      accessHook: openHook,
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
      accessHook: openHook,
      sessions: { agent: () => fakeAgent([]) },
      replyHandler: replyOver(new FakeAdapter('telegram')),
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

  it('refuses an assistant with no access policy, or with two', () => {
    const base = { channels: [], sessions: { agent: () => fakeAgent([]) } }
    expect(() => createChannelAssistant(base)).toThrow(/access/)
    expect(() =>
      createChannelAssistant({
        ...base,
        accessHook: openHook,
        access: { owners: new Set(), dm: 'open', isAuthenticated: () => false },
      }),
    ).toThrow(/exactly one/)
  })

  it('refuses owned sessions with no reply handler', () => {
    expect(() =>
      createChannelAssistant({
        channels: [],
        sessions: { agent: () => fakeAgent([]) },
        accessHook: openHook,
      }),
    ).toThrow(/replyHandler/)
  })

  it('needs a handler with a pool it is given, and uses both', async () => {
    const pool = { heldIds: () => ['a'], disposeAll: async () => undefined }
    expect(() =>
      createChannelAssistant({ channels: [], sessions: { pool }, accessHook: openHook }),
    ).toThrow(/handler/)
    const adapter = new FakeAdapter('telegram')
    const seen: string[] = []
    const assistant = createChannelAssistant({
      channels: [{ platform: 'telegram', build: () => adapter }],
      sessions: { pool },
      accessHook: openHook,
      handler: async (incoming) => {
        seen.push(incoming.text)
      },
    })
    await assistant.start()
    await adapter.deliver(event('own handler'))
    await until(() => seen.length > 0, 'the handler')
    expect(assistant.sessions).toBe(pool)
    await assistant.close()
  })

  it('stops services, channels, the sweeper and the sessions in that order, and gives the sweeper the held ids', async () => {
    const order: string[] = []
    const adapter = new FakeAdapter('telegram')
    adapter.disconnect = async () => {
      order.push('channels')
    }
    let heldSeen: readonly string[] = []
    const assistant = createChannelAssistant({
      channels: [{ platform: 'telegram', build: () => adapter }],
      sessions: {
        pool: {
          heldIds: () => ['s1'],
          disposeAll: async () => {
            order.push('sessions')
          },
        },
      },
      handler: async () => undefined,
      accessHook: openHook,
      transcripts: {
        start: (heldIds) => {
          heldSeen = heldIds()
          return {
            stop: () => {
              order.push('sweeper')
            },
          }
        },
      },
      services: [
        {
          name: 'extra',
          start: () => {
            order.push('extra:start')
          },
          stop: () => {
            order.push('extra')
          },
        },
      ],
    })
    await assistant.start()
    await assistant.close()
    expect(heldSeen).toEqual(['s1'])
    expect(order).toEqual(['extra:start', 'extra', 'channels', 'sweeper', 'sessions'])
  })

  it('masks the given streams from start and releases them at close', async () => {
    const written: string[] = []
    const stream = {
      write: (chunk: string) => {
        written.push(chunk)
        return true
      },
    } as unknown as NodeJS.WritableStream
    const assistant = createChannelAssistant({
      channels: [],
      sessions: { agent: () => fakeAgent([]) },
      replyHandler: replyOver(new FakeAdapter('telegram')),
      accessHook: openHook,
      secrets: [SECRET],
      maskStreams: [stream],
    })
    await assistant.start()
    stream.write(`leak ${SECRET}\n`)
    assistant.flushMask()
    await assistant.close()
    expect(written.join('')).not.toContain(SECRET)
    expect(written.join('')).toContain('leak')
  })

  it('answers a webhook request before start without caching an empty route table', async () => {
    const assistant = createChannelAssistant({
      channels: [],
      sessions: { agent: () => fakeAgent([]) },
      replyHandler: replyOver(new FakeAdapter('telegram')),
      accessHook: openHook,
    })
    expect((await assistant.router(new Request('http://localhost/webhooks/telegram'))).status).toBe(
      404,
    )
    await assistant.start()
    expect((await assistant.router(new Request('http://localhost/webhooks/telegram'))).status).toBe(
      404,
    )
    await assistant.close()
  })

  it('settles ready and tears down when a service fails to start', async () => {
    const disposed: string[] = []
    const assistant = createChannelAssistant({
      channels: [],
      sessions: {
        pool: {
          heldIds: () => [],
          disposeAll: async () => {
            disposed.push('sessions')
          },
        },
      },
      handler: async () => undefined,
      accessHook: openHook,
      transcripts: {
        start: () => {
          throw new Error('sweeper refused')
        },
      },
    })
    await expect(assistant.start()).rejects.toThrow()
    await assistant.ready
    expect(disposed).toEqual(['sessions'])
    await assistant.close()
  })
})

describe('the declared @theokit/sdk range', () => {
  it('starts at the SDK that has Agent.sessionPool({ agent }) and the mask flush()', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
      peerDependencies: Record<string, string>
    }
    const floor = /^>=(\d+)\./.exec(pkg.peerDependencies['@theokit/sdk'] ?? '')
    expect(Number(floor?.[1])).toBeGreaterThanOrEqual(12)
  })
})
