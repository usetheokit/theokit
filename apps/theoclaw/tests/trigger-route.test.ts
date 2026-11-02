/**
 * B-397 FR-003 to FR-006, NFR-001, NFR-002 (AC-002): a signed `POST /hooks/<name>` is verified,
 * deduplicated by its delivery id, answered 202 at once, and runs one agent whose answer is sent
 * once to the trigger's reply channel.
 */
import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import type { TurnAgent } from '../src/agent-port.js'
import { createTriggerRoute } from '../src/triggers/trigger-route.js'
import { createWebhookRouter, MAX_BODY_BYTES } from '../src/webhooks/router.js'
import type { TriggerSettings } from '../src/triggers/trigger-settings.js'
import { FakeAdapter, FakeAgent, assistant, deferred, finished, waitFor } from './fakes.js'

const SECRET = 'trigger-secret-0123'
const TRIGGER: TriggerSettings = { name: 'ci', secret: SECRET, replyTo: { platform: 'telegram', channelId: '42' } }

function signature(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

function delivery(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/hooks/ci', {
    method: 'POST',
    headers: { 'x-hub-signature-256': signature(body), ...headers },
    body,
  })
}

interface Harness {
  readonly adapter: FakeAdapter
  readonly agents: FakeAgent[]
  readonly lines: string[]
  started: boolean
  readonly handle: (request: Request) => Promise<Response>
}

function harness(agent: () => FakeAgent = () => new FakeAgent({ frames: [assistant('build is green'), finished()] }), trigger = TRIGGER): Harness {
  const adapter = new FakeAdapter('telegram')
  const agents: FakeAgent[] = []
  const lines: string[] = []
  const state: Harness = {
    adapter,
    agents,
    lines,
    started: true,
    handle: (request) => route.handle(request),
  }
  const route = createTriggerRoute({
    trigger,
    adapterFor: (platform) => (state.started && platform === 'telegram' ? adapter : undefined),
    withAgent: async (work) => {
      const made = agent()
      agents.push(made)
      return work(made as unknown as TurnAgent)
    },
    write: (line) => lines.push(line),
  })
  return state
}

describe('createTriggerRoute', () => {
  it('takes POST only', () => {
    expect(createTriggerRoute({ trigger: TRIGGER, adapterFor: () => undefined, withAgent: async () => undefined as never, write: () => undefined }).methods).toEqual(['POST'])
  })

  it('answers 401 and starts no run on a wrong signature', async () => {
    const h = harness()
    const response = await h.handle(delivery('{"a":1}', { 'x-hub-signature-256': signature('{"a":1}', 'another-secret-xyz') }))
    expect(response.status).toBe(401)
    expect(h.agents).toHaveLength(0)
  })

  it('answers 401 and starts no run on a missing signature header', async () => {
    const h = harness()
    const response = await h.handle(new Request('http://localhost/hooks/ci', { method: 'POST', body: '{"a":1}' }))
    expect(response.status).toBe(401)
    expect(h.agents).toHaveLength(0)
  })

  it('writes nothing about a refused body', async () => {
    const h = harness()
    await h.handle(delivery('marker-body-B', { 'x-hub-signature-256': signature('x') }))
    expect(h.lines.join('\n')).not.toContain('marker-body-B')
  })

  it('answers 202 within 1000 ms while the run never settles', async () => {
    const h = harness(() => new FakeAgent({ frames: [], before: new Promise(() => undefined) }))
    const startedAt = Date.now()
    const response = await h.handle(delivery('{}'))
    expect(response.status).toBe(202)
    expect(Date.now() - startedAt).toBeLessThan(1000)
  })

  it("sends the run's text once to the configured channel", async () => {
    const h = harness()
    expect((await h.handle(delivery('{"ref":"main"}'))).status).toBe(202)
    await waitFor(() => h.adapter.sent.length === 1, 5000, 'the trigger reply')
    expect(h.adapter.sent[0]?.channel.id).toBe('42')
    expect(h.adapter.sent[0]?.text).toContain('build is green')
    expect(h.agents[0]?.sent[0]).toContain('The following was delivered by trigger ci:')
    expect(h.agents[0]?.sent[0]).toContain('{"ref":"main"}')
  })

  it('puts the trigger instructions before the delivered body', async () => {
    const h = harness(undefined, { ...TRIGGER, instructions: 'Summarise the build.' })
    await h.handle(delivery('{}'))
    await waitFor(() => h.agents.length === 1, 5000, 'the run')
    expect(h.agents[0]?.sent[0]).toBe('Summarise the build.\n\nThe following was delivered by trigger ci:\n\n{}')
  })

  it('answers 200 and starts no run for a repeated delivery id', async () => {
    const h = harness()
    expect((await h.handle(delivery('{}', { 'x-theoclaw-delivery': 'd-1' }))).status).toBe(202)
    expect((await h.handle(delivery('{}', { 'x-theoclaw-delivery': 'd-1' }))).status).toBe(200)
    await waitFor(() => h.adapter.sent.length === 1, 5000, 'the one reply')
    expect(h.agents).toHaveLength(1)
  })

  it('answers 503 while the reply platform has not started, and accepts the same id after start', async () => {
    const h = harness()
    h.started = false
    expect((await h.handle(delivery('{}', { 'x-theoclaw-delivery': 'd-2' }))).status).toBe(503)
    expect(h.agents).toHaveLength(0)
    h.started = true
    expect((await h.handle(delivery('{}', { 'x-theoclaw-delivery': 'd-2' }))).status).toBe(202)
  })

  it('treats an empty x-theoclaw-delivery as absent: two such deliveries both answer 202 (EC-3)', async () => {
    const h = harness()
    expect((await h.handle(delivery('{}', { 'x-theoclaw-delivery': ' ' }))).status).toBe(202)
    expect((await h.handle(delivery('{}', { 'x-theoclaw-delivery': '' }))).status).toBe(202)
    await waitFor(() => h.agents.length === 2, 5000, 'two runs')
  })

  it('answers 400 and starts no run for an x-theoclaw-delivery longer than 256 characters (EC-3)', async () => {
    const h = harness()
    expect((await h.handle(delivery('{}', { 'x-theoclaw-delivery': 'x'.repeat(257) }))).status).toBe(400)
    expect((await h.handle(delivery('{}', { 'x-theoclaw-delivery': 'x'.repeat(256) }))).status).toBe(202)
    await waitFor(() => h.agents.length === 1, 5000, 'the one run')
  })

  it('a run with status error sends nothing and writes one line naming the trigger', async () => {
    const h = harness(() => new FakeAgent({ frames: [finished()], result: { status: 'error', error: { code: 'MODEL_DOWN' } } }))
    await h.handle(delivery('{}'))
    await waitFor(() => h.lines.length === 1, 5000, 'the failure line')
    expect(h.lines[0]).toBe('trigger ci: run failed (MODEL_DOWN)')
    expect(h.adapter.sent).toHaveLength(0)
  })

  it('a run whose send throws writes one line naming the trigger', async () => {
    const h = harness(() => {
      const agent = new FakeAgent({ frames: [] })
      agent.send = () => Promise.reject(new Error('socket hang up'))
      return agent
    })
    await h.handle(delivery('{}'))
    await waitFor(() => h.lines.length === 1, 5000, 'the failure line')
    expect(h.lines[0]).toBe('trigger ci: run failed (socket hang up)')
  })

  it('writes one masked line naming the code when the platform refuses the reply, with no retry', async () => {
    const adapterRefusal = harness()
    ;(adapterRefusal.adapter as unknown as { options: { send: () => Promise<unknown> } }).options.send = async () => ({
      ok: false,
      error: { code: 'CHAT_NOT_FOUND', message: 'no chat 42' },
    })
    await adapterRefusal.handle(delivery('{}'))
    await waitFor(() => adapterRefusal.lines.length === 1, 5000, 'the refusal line')
    expect(adapterRefusal.lines[0]).toBe('trigger ci: the reply was not delivered (CHAT_NOT_FOUND)')
    expect(adapterRefusal.adapter.sent).toHaveLength(1)
  })
})

describe('a reply adapter whose sendMessage throws', () => {
  it('writes one line naming the trigger and the error name, and does not retry', async () => {
    let calls = 0
    const adapter = new FakeAdapter('telegram', {
      send: async () => {
        calls += 1
        throw new TypeError('socket closed with chat 42')
      },
    })
    const lines: string[] = []
    const route = createTriggerRoute({
      trigger: TRIGGER,
      adapterFor: () => adapter,
      withAgent: async (work) => work(new FakeAgent({ frames: [assistant('done'), finished()] }) as unknown as TurnAgent),
      write: (line) => lines.push(line),
    })
    expect((await route.handle(delivery('{}'))).status).toBe(202)
    await waitFor(() => lines.length === 1, 5000, 'the delivery failure line')
    expect(lines[0]).toBe('trigger ci: the reply was not delivered (TypeError)')
    expect(lines[0]).not.toContain('chat 42')
    expect(calls).toBe(1)
  })
})

describe('concurrent deliveries', () => {
  it('two deliveries with the same id sent at once: exactly one 202, one 200, and one run', async () => {
    const h = harness()
    const responses = await Promise.all([
      h.handle(delivery('{}', { 'x-theoclaw-delivery': 'same' })),
      h.handle(delivery('{}', { 'x-theoclaw-delivery': 'same' })),
    ])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 202])
    await waitFor(() => h.adapter.sent.length === 1, 5000, 'the one reply')
    expect(h.agents).toHaveLength(1)
  })

  it('a run that never settles does not delay a second delivery', async () => {
    const hold = deferred<void>()
    const h = harness(() => new FakeAgent({ frames: [], before: hold.promise }))
    const startedAt = Date.now()
    const statuses = await Promise.all([h.handle(delivery('{}')), h.handle(delivery('{"n":2}'))])
    expect(statuses.map((response) => response.status)).toEqual([202, 202])
    expect(Date.now() - startedAt).toBeLessThan(1000)
    hold.resolve()
  })
})
describe('through the webhook router', () => {
  function routed(): { readonly h: Harness; readonly router: (request: Request) => Promise<Response> } {
    const h = harness()
    const router = createWebhookRouter({
      routes: new Map(),
      triggers: new Map([['ci', createTriggerRoute({ trigger: TRIGGER, adapterFor: () => h.adapter, withAgent: async (work) => work(new FakeAgent({ frames: [assistant('ok'), finished()] }) as unknown as TurnAgent), write: () => undefined })]]),
      isStarted: () => true,
      write: () => undefined,
    })
    return { h, router }
  }

  it('answers 413 past 1 MiB', async () => {
    const { router } = routed()
    const body = 'x'.repeat(MAX_BODY_BYTES + 1)
    const response = await router(delivery(body))
    expect(response.status).toBe(413)
    expect(response.headers.get('connection')).toBe('close')
  })

  it('accepts a body of exactly 1048576 bytes with 202 (EC-4)', async () => {
    const { router } = routed()
    const body = 'x'.repeat(MAX_BODY_BYTES)
    expect((await router(delivery(body))).status).toBe(202)
  })
})
