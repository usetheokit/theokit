import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { adapterBuilders } from '../src/channels/adapter-factory.js'
import { descriptorFor, resolvePlatforms } from '../src/channels/platforms.js'
import { gatewayRouter, offline } from './webhook-fixtures.js'

/** The Google Chat webhook as the gateway's webhook handler serves it over TheoClaw's adapter. */

function keyFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'gchat-webhook-')), 'sa.json')
  writeFileSync(path, JSON.stringify({ client_email: 'bot@p.iam.gserviceaccount.com', private_key: 'x' }))
  return path
}

const ENV = { THEOCLAW_GOOGLE_CHAT_SERVICE_ACCOUNT_FILE: keyFile(), THEOCLAW_GOOGLE_CHAT_AUDIENCE: 'https://example.org/webhooks/google_chat' }

function rig(handleRequest: (authorization: string, raw: string) => Promise<{ status: number; body: unknown }>, started = true) {
  const entry = resolvePlatforms(ENV).configured[0]!
  const adapter = Object.assign(offline(adapterBuilders([entry])[0]!.build()), { handleRequest })
  return gatewayRouter({ channels: [{ descriptor: descriptorFor(entry.platform, entry.settings), adapter }], isStarted: () => started })
}

function request(headers: Record<string, string>, body = '{}'): Request {
  return new Request('http://localhost/webhooks/google_chat', { method: 'POST', headers, body })
}

describe('the Google Chat webhook', () => {
  it('forwards the bearer header and raw body, and answers what the adapter answers', async () => {
    const seen: unknown[] = []
    const router = rig(async (authorization, raw) => {
      seen.push(authorization, raw)
      return { status: 200, body: {} }
    })
    const response = await router(request({ authorization: 'Bearer abc' }, '{"type":"MESSAGE"}'))
    expect(response.status).toBe(200)
    expect(seen).toEqual(['Bearer abc', '{"type":"MESSAGE"}'])
  })

  it('refuses a request with no bearer token before reading the adapter', async () => {
    const router = rig(async () => {
      throw new Error('must not be called')
    })
    expect((await router(request({}))).status).toBe(401)
  })

  it('passes the adapter refusal through', async () => {
    const router = rig(async () => ({ status: 503, body: { error: 'keys' } }))
    const response = await router(request({ authorization: 'Bearer abc' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'keys' })
  })

  it('answers 503 before the platform starts, 405 for a method it does not take, 500 when the adapter throws', async () => {
    const ok = async () => ({ status: 200, body: {} })
    expect((await rig(ok, false)(request({ authorization: 'Bearer abc' }))).status).toBe(503)
    expect((await rig(ok)(new Request('http://localhost/webhooks/google_chat', { method: 'GET' }))).status).toBe(405)
    const throwing = rig(async () => {
      throw new Error('keys broke')
    })
    expect((await throwing(request({ authorization: 'Bearer abc' }))).status).toBe(500)
  })

  it('refuses a body over 1 MiB with 413 without calling the adapter', async () => {
    let called = false
    const router = rig(async () => {
      called = true
      return { status: 200, body: {} }
    })
    const response = await router(request({ authorization: 'Bearer abc' }, 'x'.repeat(1024 * 1024 + 1)))
    expect(response.status).toBe(413)
    expect(called).toBe(false)
  })
})
