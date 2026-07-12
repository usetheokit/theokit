import { describe, expect, it } from 'vitest'

import { createInMemoryRunEventCache } from '../../packages/theo/src/server/agent/run-event-cache.js'
import {
  handleThreadMessage,
  handleThreadStream,
  isThreadMessagePath,
  isThreadStreamPath,
} from '../../packages/theo/src/server/agent/handle-thread-routes.js'
import {
  createInProcessThreadRunRegistry,
  getThreadRunRegistry,
  type ThreadRunRegistry,
} from '../../packages/theo/src/server/agent/thread-run-registry.js'
import { getRunEventCache } from '../../packages/theo/src/server/agent/run-event-cache.js'
import { serveAgentAuxRoute } from '../../packages/theo/src/server/agent/serve-aux-routes.js'

/**
 * M39 (ADR-0048) — the thread HTTP routes. Deterministic: the message route is
 * exercised only on its non-LLM paths (queue / 400 / CSRF); the idle-START path
 * (which drives the SDK) is covered by the dispatcher unit test. The stream route
 * is exercised with injected fakes.
 */

async function readSse(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let out = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    out += dec.decode(value)
  }
  return out
}

describe('M39 — thread route matchers', () => {
  it('matches the message + stream paths and decodes name/sessionId', () => {
    expect(isThreadMessagePath('/api/agents/bot/threads/s%201/message')).toEqual({
      name: 'bot',
      sessionId: 's 1',
    })
    expect(isThreadStreamPath('/api/agents/bot/threads/s1/stream')).toEqual({
      name: 'bot',
      sessionId: 's1',
    })
    expect(isThreadMessagePath('/api/agents/bot/runs/r1/stream')).toBeNull()
    expect(isThreadStreamPath('/api/agents/bot/threads/s1/message')).toBeNull()
  })
})

describe('M39 — POST thread message', () => {
  const post = (body: unknown) =>
    new Request('http://x/api/agents/bot/threads/s/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify(body),
    })

  it('rejects an empty body with 400', async () => {
    const res = await handleThreadMessage({
      mod: {},
      apiKey: 'key',
      sessionId: 'sess-400',
      request: post({}),
      source: 'agent "bot"',
      csrfMode: 'off',
    })
    expect(res.status).toBe(400)
  })

  it('rejects a cross-origin POST with 403 under strict CSRF (drives the agent)', async () => {
    const res = await handleThreadMessage({
      mod: {},
      apiKey: 'key',
      sessionId: 'sess-403',
      request: post({ message: 'hi' }),
      source: 'agent "bot"',
      csrfMode: 'strict',
    })
    expect(res.status).toBe(403)
  })

  it('QUEUEs a follow-up (202) when the thread already has an active run — no agent started', async () => {
    // Seed the singletons the route uses with an active run for a UNIQUE session.
    const sessionId = `sess-queue-${Math.floor(performance.now())}`
    getRunEventCache().begin('run-active')
    getThreadRunRegistry().startRun(sessionId, 'run-active')

    const res = await handleThreadMessage({
      mod: {},
      apiKey: 'key',
      sessionId,
      request: new Request('http://x/api/agents/bot/threads/s/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'follow up' }),
      }),
      source: 'agent "bot"',
      csrfMode: 'off',
    })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ queued: true })
  })
})

describe('M39 — GET thread stream', () => {
  it('attaches to the ACTIVE run and replays its frames (reuses the M37 reconnect)', async () => {
    const registry = createInProcessThreadRunRegistry()
    const cache = createInMemoryRunEventCache()
    cache.begin('run-a')
    cache.append('run-a', JSON.stringify({ type: 'text-delta', delta: 'hello' }))
    cache.end('run-a')
    registry.startRun('s1', 'run-a')

    const res = handleThreadStream('s1', new Request('http://x'), registry, cache)
    expect(res.status).toBe(200)
    const body = await readSse(res)
    expect(body).toContain('hello')
    expect(body).toContain('[DONE]')
  })

  it('subscribe-to-idle waits for the NEXT run, then attaches (subscribe-then-post)', async () => {
    const registry = createInProcessThreadRunRegistry()
    const cache = createInMemoryRunEventCache()
    const res = handleThreadStream('s1', new Request('http://x'), registry, cache, 5_000)

    // A run starts AFTER the subscription — the waiter fires + attaches.
    cache.begin('run-b')
    registry.startRun('s1', 'run-b')
    cache.append('run-b', JSON.stringify({ type: 'text-delta', delta: 'later' }))
    cache.end('run-b')

    const body = await readSse(res)
    expect(body).toContain('later')
    expect(body).toContain('[DONE]')
  })

  it('subscribe-to-idle closes after the bounded wait when no run starts', async () => {
    const registry = createInProcessThreadRunRegistry()
    const cache = createInMemoryRunEventCache()
    const res = handleThreadStream('s-idle', new Request('http://x'), registry, cache, 20)
    const body = await readSse(res)
    expect(body).toContain('[DONE]') // idle wait expired → stream closed
  })

  it('the idle-wait timeout unsubscribes the next-run waiter (HIGH-1 — no leak)', async () => {
    let unsubscribed = false
    const fakeRegistry = {
      getActive: () => null,
      onNextRun: () => () => {
        unsubscribed = true
      },
      startRun: () => {},
      endRun: () => undefined,
      queue: () => {},
    } as unknown as ThreadRunRegistry
    const res = handleThreadStream(
      's1',
      new Request('http://x'),
      fakeRegistry,
      createInMemoryRunEventCache(),
      15,
    )
    await readSse(res) // drains until [DONE] (the bounded wait expires)
    expect(unsubscribed).toBe(true)
  })
})

describe('M39 — serveThreadRoute dispatch (LOW-1)', () => {
  const agents = [{ name: 'bot', filePath: '/x/bot.ts', agentPath: '/bot' }]
  const baseDeps = {
    agents,
    loadModule: async () => ({}),
    baseUrl: 'http://x',
    resolveApiKey: () => 'key',
  }

  it('GET thread stream falls through (null) on an unknown agent', async () => {
    const req = new Request('http://x/api/agents/nope/threads/s/stream')
    const res = await serveAgentAuxRoute(req, '/api/agents/nope/threads/s/stream', baseDeps)
    expect(res).toBeNull()
  })

  it('POST thread message with a wrong method falls through (null)', async () => {
    const req = new Request('http://x/api/agents/bot/threads/s/message', { method: 'GET' })
    const res = await serveAgentAuxRoute(req, '/api/agents/bot/threads/s/message', baseDeps)
    expect(res).toBeNull()
  })

  it('POST thread message returns 501 when resolveApiKey is not wired', async () => {
    const req = new Request('http://x/api/agents/bot/threads/s/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const { resolveApiKey: _omit, ...depsNoKey } = baseDeps
    const res = await serveAgentAuxRoute(req, '/api/agents/bot/threads/s/message', depsNoKey)
    expect(res?.status).toBe(501)
  })
})
