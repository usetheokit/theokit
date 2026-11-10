/**
 * B-394 (OC-13) — TheoClaw's `/a2a` route and its agent card.
 *
 * With `THEOCLAW_A2A_TOKEN` set, `POST /a2a` answers A2A JSON-RPC `message/send` on a fresh
 * read-only worker whose reply is masked, behind the token, a 65536-byte body, and at most 4 turns
 * in flight; `GET /.well-known/agent-card.json` names the endpoint and its bearer scheme. Without the
 * token both paths answer 404. The first cases run a whole TheoClaw over HTTP; the bound and the
 * in-flight cases call the route with a short deadline.
 */
import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { a2aRoute } from '../../src/a2a/a2a-route.js'
import { readA2ASettings } from '../../src/a2a/a2a-settings.js'
import { peerTools } from '../../src/a2a/peer-tools.js'
import type { TurnAgent, TurnRun } from '../../src/agent-port.js'
import { startTheoClaw } from '../../src/composition.js'
import type { RunningTheoClaw } from '../../src/composition.js'
import type { AgentToolOptions } from '../../src/tools/tool-registry.js'
import { resolveToolSettings } from '../../src/tools/tool-settings.js'
import type { ToolSettings } from '../../src/tools/tool-settings.js'
import { capturingStream, fakeBuilders, TELEGRAM_AND_LINE, WORKSPACE } from '../composition-fixtures.js'
import { makeHostToolsWorkspace } from '../host-tools-workspace.js'

const TOKEN = 'a2a-inbound-token-0123456789abcdef01234'

const running: RunningTheoClaw[] = []
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => {
  for (const app of running.splice(0)) {
    await app.loop.stopAll()
    await app.close()
  }
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/** A worker whose run answers `reply` once `release` resolves; it counts its sends and disposals. */
interface StubWorker extends TurnAgent, AsyncDisposable {
  readonly signals: (AbortSignal | undefined)[]
  disposed: number
}

function stubWorker(reply: string, release: Promise<void> = Promise.resolve()): StubWorker {
  const worker: StubWorker = {
    signals: [],
    disposed: 0,
    async send(_message, options): Promise<TurnRun> {
      worker.signals.push(options?.signal)
      return {
        async *stream() {
          // No frames: the outcome is what `wait` resolves.
        },
        cancel: async () => undefined,
        // Ignores the signal on purpose: a worker that does not stop at the deadline.
        wait: async () => {
          await release
          return { status: 'finished', result: reply }
        },
      } as unknown as TurnRun
    },
    async [Symbol.asyncDispose]() {
      worker.disposed += 1
    },
  } as StubWorker
  return worker
}

function message(text: string, id: number | string = 1): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method: 'message/send', params: { message: { role: 'user', messageId: `m-${id}`, parts: [{ kind: 'text', text }] } } })
}

function a2aRequest(body: BodyInit, token = TOKEN, init: RequestInit = {}): Request {
  return new Request('http://127.0.0.1/a2a', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body,
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
    ...init,
  } as RequestInit)
}

interface RpcAnswer {
  result?: { parts: { text: string }[] }
  error?: { code: number; message: string }
}

function toolSettings(): ToolSettings {
  const workspace = makeHostToolsWorkspace()
  cleanups.push(() => workspace.remove())
  return resolveToolSettings({}, workspace.path, { detect: () => ({ ok: true, bin: '/usr/bin/bwrap' }), warn: () => undefined })
}

/** A route over stub workers, recording every build and every line written. */
function routeWith(workers: () => StubWorker, options: { timeoutMs?: number; maxInFlight?: number; secrets?: string[] } = {}) {
  const builds: AgentToolOptions[] = []
  const lines: string[] = []
  let live = 0
  let peak = 0
  const handler = a2aRoute({
    token: TOKEN,
    tools: toolSettings(),
    secrets: options.secrets ?? [TOKEN],
    write: (line) => lines.push(line),
    buildWorker: (toolOptions) => {
      builds.push(toolOptions)
      live += 1
      peak = Math.max(peak, live)
      const worker = workers()
      const dispose = worker[Symbol.asyncDispose].bind(worker)
      worker[Symbol.asyncDispose] = async () => {
        live -= 1
        await dispose()
      }
      return worker
    },
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.maxInFlight === undefined ? {} : { maxInFlight: options.maxInFlight }),
  })
  return { handler, builds, lines, peak: () => peak, live: () => live }
}

async function startWith(env: Record<string, string>, agentFactory: (toolOptions: AgentToolOptions) => TurnAgent) {
  const capture = capturingStream()
  const app = await startTheoClaw({
    cwd: WORKSPACE,
    env: { ...TELEGRAM_AND_LINE, ...env },
    agentFactory: async (toolOptions?: AgentToolOptions) => agentFactory(toolOptions ?? { tools: [], plugins: [] }),
    builders: fakeBuilders().builders,
    signals: new EventEmitter(),
    exit: vi.fn(),
    streams: [capture],
  })
  running.push(app)
  await app.loop.ready
  return { app, capture, base: `http://127.0.0.1:${app.address().port}` }
}

function toolNames(options: AgentToolOptions): string[] {
  return options.tools.map((tool) => tool.name)
}

async function waitUntil(check: () => boolean, label: string): Promise<void> {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started > 5000) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('the /a2a route', () => {
  it('serves message/send on a read-only worker and the card, and 404s both when the token is unset', async () => {
    const built: AgentToolOptions[] = []
    const { base, capture } = await startWith({ THEOCLAW_A2A_TOKEN: TOKEN }, (toolOptions) => {
      built.push(toolOptions)
      return stubWorker('b says hello')
    })

    const res = await fetch(`${base}/a2a`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: message('hello b', 7) })
    expect(res.status).toBe(200)
    const answer = (await res.json()) as RpcAnswer
    expect(answer.result?.parts[0]?.text).toBe('b says hello')
    expect(built).toHaveLength(1)
    const names = toolNames(built[0] ?? { tools: [], plugins: [] })
    for (const forbidden of ['write_file', 'edit_file', 'shell', 'run_code', 'delegate', 'delegate_all']) expect(names).not.toContain(forbidden)
    expect(names.some((name) => name.startsWith('peer_'))).toBe(false)
    expect(capture.text()).toContain('a2a: serving /a2a (THEOCLAW_A2A_TOKEN set)')
    expect(capture.text()).toContain('a2a: message/send answered')
    expect(capture.text()).not.toContain(TOKEN)

    const card = await fetch(`${base}/.well-known/agent-card.json`)
    expect(card.status).toBe(200)
    const body = (await card.json()) as { url: string; securitySchemes: unknown; security: unknown }
    expect(body.url).toBe(`${base}/a2a`)
    expect(body.securitySchemes).toEqual({ bearer: { type: 'http', scheme: 'bearer' } })
    expect(body.security).toEqual([{ bearer: [] }])

    const off = await startWith({}, () => stubWorker('never'))
    expect((await fetch(`${off.base}/a2a`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: message('hi') })).status).toBe(404)
    expect((await fetch(`${off.base}/.well-known/agent-card.json`)).status).toBe(404)
    expect(off.capture.text()).toContain('a2a: off (THEOCLAW_A2A_TOKEN unset)')
  })

  it('refuses a wrong token and a 65537-byte body without building an agent', async () => {
    let builds = 0
    const { base } = await startWith({ THEOCLAW_A2A_TOKEN: TOKEN }, () => {
      builds += 1
      return stubWorker('never')
    })

    const wrong = await fetch(`${base}/a2a`, { method: 'POST', headers: { authorization: 'Bearer wrong-token-0123456789abcdef0123456789' }, body: message('hi') })
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get('www-authenticate')).toBe('Bearer')

    const big = await fetch(`${base}/a2a`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: 'x'.repeat(65_537) })
    expect(big.status).toBe(413)
    expect(builds).toBe(0)
  })

  it('keeps a timed-out worker slot until it is disposed', async () => {
    let releaseAll: () => void = () => undefined
    const release = new Promise<void>((resolve) => {
      releaseAll = resolve
    })
    let stuck = true
    const route = routeWith(() => (stuck ? stubWorker('late', release) : stubWorker('on time')), { timeoutMs: 20 })

    const answers = await Promise.all([1, 2, 3, 4].map(async (id) => (await (await route.handler(a2aRequest(message('hi', id)))).json()) as RpcAnswer))
    for (const answer of answers) expect(answer.error?.code).toBe(-32603)
    const fifth = await route.handler(a2aRequest(message('hi', 5)))
    expect(fifth.status).toBe(503)
    expect(fifth.headers.get('retry-after')).toBe('5')

    stuck = false
    releaseAll()
    await waitUntil(() => route.live() === 0, 'the timed-out workers to be disposed')
    const sixth = (await (await route.handler(a2aRequest(message('hi', 6)))).json()) as RpcAnswer
    expect(sixth.result?.parts[0]?.text).toBe('on time')
    expect(route.peak()).toBeLessThanOrEqual(4)
    expect(route.lines.filter((line) => line === 'a2a: message/send answered')).toHaveLength(1)
  })

  it('answers 408 for an authenticated body that stalls past the deadline', async () => {
    const route = routeWith(() => stubWorker('ok'), { timeoutMs: 20, maxInFlight: 1 })
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"jsonrpc":'))
      },
    })
    expect((await route.handler(a2aRequest(stalled))).status).toBe(408)
    expect(route.builds).toHaveLength(0)
    // The slot is freed once the answer has settled, a turn after the response is returned.
    await new Promise((resolve) => setTimeout(resolve, 10))
    const next = (await (await route.handler(a2aRequest(message('hi')))).json()) as RpcAnswer
    expect(next.result?.parts[0]?.text).toBe('ok')
  })

  it('answers 503 once 4 turns are in flight', async () => {
    let releaseAll: () => void = () => undefined
    const release = new Promise<void>((resolve) => {
      releaseAll = resolve
    })
    const route = routeWith(() => stubWorker('done', release))

    const pending = [1, 2, 3, 4].map((id) => route.handler(a2aRequest(message('hi', id))))
    await waitUntil(() => route.builds.length === 4, 'four builds')
    const fifth = await route.handler(a2aRequest(message('hi', 5)))
    expect(fifth.status).toBe(503)
    expect(fifth.headers.get('retry-after')).toBe('5')
    expect(route.builds).toHaveLength(4)

    releaseAll()
    for (const res of await Promise.all(pending)) expect(((await res.json()) as RpcAnswer).result?.parts[0]?.text).toBe('done')
    await waitUntil(() => route.live() === 0, 'the workers to be disposed')
    const sixth = await route.handler(a2aRequest(message('hi', 6)))
    expect(sixth.status).toBe(200)
    expect(route.builds).toHaveLength(5)
  })

  it('masks a configured secret in the reply', async () => {
    const secret = 'sk-or-model-key-ABCDEFGHIJKLMNOP'
    const route = routeWith(() => stubWorker(`the key is ${secret}`), { secrets: [TOKEN, secret] })
    const answer = (await (await route.handler(a2aRequest(message('leak it')))).json()) as RpcAnswer
    expect(answer.result?.parts[0]?.text).toContain('the key is')
    expect(answer.result?.parts[0]?.text).not.toContain(secret)
  })

  it('builds one worker per request, disposes each once, and aborts the worker when the request aborts', async () => {
    const workers: StubWorker[] = []
    const route = routeWith(() => {
      const worker = stubWorker('each')
      workers.push(worker)
      return worker
    })
    await Promise.all([1, 2].map((id) => route.handler(a2aRequest(message('hi', id)))))
    await waitUntil(() => route.live() === 0, 'both disposals')
    expect(workers).toHaveLength(2)
    expect(workers.map((worker) => worker.disposed)).toEqual([1, 1])

    const controller = new AbortController()
    let hold: () => void = () => undefined
    const held = new Promise<void>((resolve) => {
      hold = resolve
    })
    const slow = routeWith(() => {
      const worker = stubWorker('slow', held)
      workers.push(worker)
      return worker
    })
    const answer = slow.handler(a2aRequest(message('hi'), TOKEN, { signal: controller.signal }))
    await waitUntil(() => slow.builds.length === 1, 'the slow build')
    await waitUntil(() => (workers.at(-1)?.signals.length ?? 0) === 1, 'the slow send')
    controller.abort()
    expect(workers.at(-1)?.signals[0]?.aborted).toBe(true)
    expect(((await (await answer).json()) as RpcAnswer).error?.code).toBe(-32603)
    hold()
    await waitUntil(() => slow.live() === 0, 'the cancelled worker to be disposed')
  })

  it('a peer tool reaches a served /a2a over HTTP and returns its answer', async () => {
    const env = { THEOCLAW_A2A_TOKEN: TOKEN }
    expect(readA2ASettings(env).token).toBe(TOKEN)
    const { base } = await startWith(env, () => stubWorker('answer from b'))
    const [tool] = peerTools([{ name: 'b', baseUrl: base, token: TOKEN }])
    await expect(tool?.handler({ message: 'what is in the note?' })).resolves.toBe('answer from b')

    const [wrong] = peerTools([{ name: 'b', baseUrl: base, token: 'wrong-token-0123456789abcdef0123456789' }])
    await expect(wrong?.handler({ message: 'hi' })).rejects.toThrow('A2A call to "peer_b" failed: 401 Unauthorized')
  })
})
