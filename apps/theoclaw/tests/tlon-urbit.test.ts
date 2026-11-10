import 'reflect-metadata'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MessageEvent } from '@theokit/gateway'

import { adapterBuilders } from '../src/channels/adapter-factory.js'
import { startChannelLoop } from '../src/channels/channel-loop.js'
import type { ChannelLoop } from '../src/channels/channel-loop.js'
import { resolvePlatforms } from '../src/channels/platforms.js'
import { waitFor } from './fakes.js'

const SHIP_URL = 'http://ship.test:8080'
const CODE = 'lidlut-tabwed-pillex-ridrup'
const ENV = {
  THEOCLAW_TLON_URBIT_SHIP_URL: SHIP_URL,
  THEOCLAW_TLON_URBIT_SHIP: 'sampel-palnet',
  THEOCLAW_TLON_URBIT_CODE: CODE,
}

/**
 * A fake ship: the few Eyre endpoints the adapter calls, answered from memory. It speaks only what
 * a ship speaks; the Urbit protocol code under test lives in the adapter, not in TheoClaw.
 */
class FakeShip {
  readonly pokes: { readonly app: string; readonly mark: string; readonly json: any }[] = []
  readonly logins: string[] = []
  private stream: ReadableStreamDefaultController<Uint8Array> | undefined
  private subscriptionId = 0
  private eventId = 0
  /** Frames queued before the event stream is opened, as Eyre keeps a channel's events. */
  private backlog: Uint8Array[] = []

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url === `${SHIP_URL}/~/login`) {
      this.logins.push(String(init?.body))
      return new Response(null, { status: 204, headers: { 'set-cookie': 'urbauth-~sampel-palnet=abc; Path=/' } })
    }
    if (url.startsWith(`${SHIP_URL}/~/channel/`) && method === 'PUT') {
      for (const action of JSON.parse(String(init?.body)) as any[]) this.onAction(action)
      return new Response(null, { status: 204 })
    }
    if (url.startsWith(`${SHIP_URL}/~/channel/`) && method === 'GET') {
      const body = new ReadableStream<Uint8Array>({ start: (controller) => {
          this.stream = controller
          for (const chunk of this.backlog.splice(0)) controller.enqueue(chunk)
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    return new Response(null, { status: 404 })
  }

  /** A DM from `author` to the bot. */
  dm(author: string, text: string): void {
    const essay = { author, sent: 1_700_000_000_000, content: [{ inline: [text] }] }
    this.frame({ response: 'diff', id: this.subscriptionId, json: { whom: author, id: `${author}/170`, response: { add: { essay } } } })
  }

  private onAction(action: any): void {
    if (action.action === 'subscribe') {
      this.subscriptionId = action.id
      queueMicrotask(() => this.frame({ response: 'subscribe', id: action.id, ok: '.' }))
    } else if (action.action === 'poke') {
      this.pokes.push({ app: action.app, mark: action.mark, json: action.json })
      queueMicrotask(() => this.frame({ response: 'poke', id: action.id, ok: '.' }))
    }
  }

  private frame(data: unknown): void {
    this.eventId += 1
    const chunk = new TextEncoder().encode(`id: ${this.eventId}\ndata: ${JSON.stringify(data)}\n\n`)
    if (this.stream === undefined) this.backlog.push(chunk)
    else this.stream.enqueue(chunk)
  }
}

let loop: ChannelLoop | undefined
afterEach(async () => {
  await loop?.stopAll()
  loop = undefined
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function start(ship: FakeShip, handler: (event: MessageEvent) => Promise<unknown>, lines: string[]): ChannelLoop {
  vi.stubGlobal('fetch', ship.fetch)
  const resolved = resolvePlatforms(ENV)
  return startChannelLoop({
    platforms: adapterBuilders(resolved.configured),
    handler: async (event, ctx) => void (await ctx.reply(String(await handler(event)))),
    secrets: resolved.secrets,
    write: (line) => lines.push(line),
  })
}

describe('tlon_urbit', () => {
  it('runs only when the ship URL, the ship and the code are all set', () => {
    expect(resolvePlatforms(ENV).configured.map((entry) => entry.platform)).toEqual(['tlon_urbit'])
    expect(resolvePlatforms(ENV).configured[0]?.settings).toEqual({ shipUrl: SHIP_URL, ship: 'sampel-palnet', code: CODE })
    const { THEOCLAW_TLON_URBIT_CODE: _code, ...partial } = ENV
    const resolved = resolvePlatforms(partial)
    expect(resolved.configured).toEqual([])
    expect(resolved.skipped.filter((entry) => entry.platform === 'tlon_urbit')).toEqual([{ platform: 'tlon_urbit', missing: ['THEOCLAW_TLON_URBIT_CODE'] }])
  })

  it('collects the code as a secret', () => {
    expect(resolvePlatforms(ENV).secrets).toContain(CODE)
  })

  it('pokes TheoClaw’s reply back to the ship that sent a DM', async () => {
    const ship = new FakeShip()
    const lines: string[] = []
    loop = start(ship, async (event) => `echo: ${event.text}`, lines)
    await loop.ready
    expect(loop.failed).toEqual([])
    expect(ship.logins).toEqual([new URLSearchParams({ password: CODE }).toString()])

    ship.dm('~zod', 'hello')
    await waitFor(() => ship.pokes.some((poke) => poke.mark === 'chat-dm-action'), 2000, 'the reply poke')

    const poke = ship.pokes.find((entry) => entry.mark === 'chat-dm-action')
    expect(poke?.app).toBe('chat')
    expect(poke?.json.ship).toBe('~zod')
    expect(poke?.json.diff.delta.add.memo.content).toEqual([{ inline: ['echo: hello'] }])
    expect(poke?.json.diff.delta.add.memo.author).toBe('~sampel-palnet')
  })

  it('never lets the code reach a log line', async () => {
    const ship = new FakeShip()
    const lines: string[] = []
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    loop = start(ship, async () => `the code is ${CODE}`, lines)
    await loop.ready
    ship.dm('~zod', 'hello')
    await waitFor(() => ship.pokes.some((poke) => poke.mark === 'chat-dm-action'), 2000, 'the reply poke')

    const output = [...lines, ...stderr.mock.calls.map((call) => String(call[0]))].join('\n')
    expect(output).not.toContain(CODE)
    expect(JSON.stringify(resolvePlatforms({ ...ENV, THEOCLAW_TLON_URBIT_CODE: '' }).skipped)).not.toContain(CODE)
  })
})
