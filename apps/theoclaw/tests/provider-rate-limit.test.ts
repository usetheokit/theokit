/**
 * #1412: a 429 from the provider. The retry lives in `@theokit/sdk` (`RetryingLlmClient`, three
 * attempts in all, so two retries); TheoClaw adds none. These tests drive a real SDK agent built
 * from TheoClaw's own options against a provider stub that answers 429 first.
 */
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Agent } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { theoClawAgentOptions } from '../src/agent/create-agent.js'

/** The number of requests the SDK makes before it gives up on a provider that always answers 429. */
const SDK_ATTEMPTS = 3

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

/** A provider on loopback that answers `rateLimited` requests with 429, then every later one with `text`. */
async function startProvider(rateLimited: number, text: string): Promise<{ url: string; requests: () => number }> {
  let seen = 0
  const server = createServer((request, response) => {
    request.resume()
    request.on('end', () => {
      seen += 1
      if (seen <= rateLimited) {
        response.writeHead(429, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'rate limited', code: 429 } }))
        return
      }
      const chunk = (delta: Record<string, unknown>, finish: string | null): string =>
        `data: ${JSON.stringify({ id: 's', object: 'chat.completion.chunk', created: 0, model: 's', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(chunk({ role: 'assistant', content: text }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, requests: () => seen }
}

async function turn(url: string): Promise<{ status: string; error?: string; texts: string[] }> {
  const options = theoClawAgentOptions({ model: { id: 'openrouter/stub', url }, apiKey: 'sk-or-stub-0123456789' })
  const agent = await Agent.create({ ...options, local: { ...options.local, cwd: mkdtempSync(join(tmpdir(), 'theoclaw-429-')) } })
  cleanups.push(() => agent[Symbol.asyncDispose]())
  const run = await agent.send('hello')
  const texts: string[] = []
  for await (const frame of run.stream()) {
    if (frame.type === 'assistant') texts.push(JSON.stringify(frame))
  }
  const outcome = await run.wait()
  return { status: outcome.status, ...(outcome.error === undefined ? {} : { error: outcome.error.message }), texts }
}

describe('a provider that answers 429', () => {
  it('completes the turn with the 200 answer when the second request succeeds', async () => {
    const provider = await startProvider(1, 'the answer')
    const outcome = await turn(provider.url)
    expect(outcome.status).toBe('finished')
    expect(outcome.texts.join('')).toContain('the answer')
    expect(provider.requests()).toBe(2)
  }, 30_000)

  it(`ends the turn failed after ${SDK_ATTEMPTS} requests when every answer is 429`, async () => {
    const provider = await startProvider(Number.MAX_SAFE_INTEGER, 'never')
    const outcome = await turn(provider.url)
    expect(outcome.status).toBe('error')
    // Since #1479 a streamed error keeps the SDK's message after its code.
    expect(outcome.error).toBe('openrouter API error: rate_limit (HTTP 429): rate limited')
    expect(provider.requests()).toBe(SDK_ATTEMPTS)
  }, 60_000)
})
