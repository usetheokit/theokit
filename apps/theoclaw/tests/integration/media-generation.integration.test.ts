/**
 * B-385 (OC-64, image) — an image produced by the media-generation path is delivered as the
 * attachment (`sendPhoto`) of the turn's reply through the gateway. The image provider is a local
 * HTTP server answering `POST /api/v1/chat/completions` in OpenRouter's documented image-output
 * shape; Telegram's Bot API is a second local server. No network call leaves the machine.
 */
import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'
import { GatewayRunner } from '@theokit/gateway'
import { parseInbound } from '@theokit/gateway-telegram'

import { generateImage, MediaGenerationError } from '../../src/media/generation.js'
import { configuredImageReplies, withImageReplies } from '../../src/media/image-replies.js'
import { FakeAdapter, waitFor } from '../fakes.js'

const PNG = Buffer.from('89504e470d0a1a0a0000', 'hex')
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done))
})

interface Seen { path: string; auth: string | undefined; body: Buffer }
async function serve(answer: (seen: Seen) => { status: number; body: unknown }): Promise<{ url: string; seen: Seen[] }> {
  const seen: Seen[] = []
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const entry = { path: req.url ?? '', auth: req.headers.authorization, body: Buffer.concat(chunks) }
      seen.push(entry)
      const out = answer(entry)
      res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify(out.body))
    })
  })
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen }
}

const imageAnswer = { status: 200, body: { choices: [{ message: { role: 'assistant', content: 'here', images: [
  { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } },
] } }] } }

function inbound(text: string) {
  const event = parseInbound({ message: { message_id: 7, date: 10, from: { id: 1 }, chat: { id: 42, type: 'private' }, text } })
  if (!event) throw new Error('fixture did not parse')
  return event
}

describe('image generation against a local fake of the OpenRouter image API', () => {
  it('delivers the generated image as a sendPhoto attachment of the reply through the gateway', async () => {
    const openrouter = await serve(() => imageAnswer)
    const telegram = await serve(() => ({ status: 200, body: { ok: true, result: { message_id: 9 } } }))
    const env = {
      THEOCLAW_IMAGE_OPENROUTER_API_KEY: 'or-secret', THEOCLAW_TELEGRAM_TOKEN: 'tg-token',
      THEOCLAW_IMAGE_BASE_URL: `${openrouter.url}/api/v1`, THEOCLAW_IMAGE_MODEL: 'fake/image-model',
    }
    let handled = 0
    const adapter = new FakeAdapter('telegram')
    const runner = new GatewayRunner({ adapters: [adapter],
      handler: withImageReplies(async () => { handled += 1 }, configuredImageReplies(env, fetch, telegram.url)) })
    await runner.start()
    try {
      await adapter.deliver(inbound('/image a red cube'))
      await waitFor(() => telegram.seen.length === 1, 2000, 'sendPhoto')
      expect(handled).toBe(0)
      expect(adapter.sent).toEqual([])
      expect(openrouter.seen[0]?.path).toBe('/api/v1/chat/completions')
      expect(openrouter.seen[0]?.auth).toBe('Bearer or-secret')
      expect(JSON.parse(openrouter.seen[0]!.body.toString())).toMatchObject({
        model: 'fake/image-model', modalities: ['image', 'text'], messages: [{ role: 'user', content: 'a red cube' }],
      })
      expect(telegram.seen[0]?.path).toBe('/bottg-token/sendPhoto')
      const upload = telegram.seen[0]!.body
      expect(upload.includes(PNG)).toBe(true)
      expect(upload.toString('latin1')).toContain('name="chat_id"')
      expect(upload.toString('latin1')).toContain('{"message_id":7}')
    } finally { await runner.stop() }
  })

  it('answers a 402 and a 404 from the provider as typed errors and tells the chat', async () => {
    const credit = await serve(() => ({ status: 402, body: { error: { code: 402, message: 'Insufficient credits' } } }))
    const model = await serve(() => ({ status: 404, body: { error: { code: 404, message: 'No such model' } } }))
    await expect(generateImage('x', { apiKey: 'k', baseUrl: `${credit.url}/api/v1` })).rejects.toMatchObject({ code: 'insufficient_credit' })
    await expect(generateImage('x', { apiKey: 'k', baseUrl: `${model.url}/api/v1` })).rejects.toBeInstanceOf(MediaGenerationError)
    await expect(generateImage('x', { apiKey: 'k', baseUrl: `${model.url}/api/v1` })).rejects.toMatchObject({ code: 'unknown_model' })
    const bare = await serve(() => ({ status: 200, body: { choices: [{ message: { content: 'text only' } }] } }))
    await expect(generateImage('x', { apiKey: 'k', baseUrl: `${bare.url}/api/v1` })).rejects.toMatchObject({ code: 'invalid_response' })

    const telegram = await serve(() => ({ status: 200, body: { ok: true } }))
    const adapter = new FakeAdapter('telegram')
    const env = { THEOCLAW_IMAGE_OPENROUTER_API_KEY: 'or-secret', THEOCLAW_TELEGRAM_TOKEN: 't', THEOCLAW_IMAGE_BASE_URL: `${credit.url}/api/v1` }
    const runner = new GatewayRunner({ adapters: [adapter],
      handler: withImageReplies(async () => undefined, configuredImageReplies(env, fetch, telegram.url)) })
    await runner.start()
    try {
      await adapter.deliver(inbound('/image a cube'))
      await waitFor(() => adapter.sent.length === 1, 2000, 'failure reply')
      expect(adapter.sent[0]?.text).toContain('no credit')
      expect(telegram.seen).toEqual([])
    } finally { await runner.stop() }
  })

  it('passes ordinary messages through and replies to a bare /image with usage', async () => {
    const adapter = new FakeAdapter('telegram')
    let handled = 0
    const runner = new GatewayRunner({ adapters: [adapter], handler: withImageReplies(async () => { handled += 1 }, undefined) })
    await runner.start()
    try {
      await adapter.deliver(inbound('hello'))
      await waitFor(() => handled === 1, 2000, 'passthrough')
      await adapter.deliver(inbound('/image'))
      await waitFor(() => adapter.sent.length === 1, 2000, 'usage')
      expect(adapter.sent[0]?.text).toContain('Usage')
    } finally { await runner.stop() }
  })
})

