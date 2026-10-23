import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { startTheoClaw } from '../src/composition.js'
import type { RunningTheoClaw } from '../src/composition.js'
import { TheoClawBindError, TheoClawConfigError } from '../src/control-plane/errors.js'
import { listenControlPlane } from '../src/control-plane/listener.js'
import { capturingStream, fakeBuilders, noAgent, signedLinePost, TELEGRAM_AND_LINE } from './composition-fixtures.js'
import { FakeAdapter, deferred, waitFor } from './fakes.js'

/** A `listen` that binds only when the test says so, and counts the closes of what it bound. */
function heldListen(listening: Promise<void>) {
  const calls = { closes: 0 }
  const listen: typeof listenControlPlane = async (options) => {
    await listening
    const handle = await listenControlPlane(options)
    return {
      ...handle,
      close: () => {
        calls.closes += 1
        return handle.close()
      },
    }
  }
  return { listen, calls }
}

describe('startTheoClaw', () => {
  const running: RunningTheoClaw[] = []
  afterEach(async () => {
    for (const app of running.splice(0)) {
      await app.loop.stopAll()
      await app.close()
    }
  })

  it('starts serving and stops on SIGTERM', async () => {
    const { adapters, builders } = fakeBuilders()
    const signals = new EventEmitter()
    const exit = vi.fn()
    const capture = capturingStream()
    const app = await startTheoClaw({ env: TELEGRAM_AND_LINE, agentFactory: noAgent, builders, signals, exit, streams: [capture] })
    running.push(app)
    await app.loop.ready
    const base = `http://127.0.0.1:${app.address().port}`

    expect((await fetch(signedLinePost(base))).status).toBe(200)
    signals.emit('SIGTERM')
    await waitFor(() => exit.mock.calls.length === 1, 2000, 'exit after SIGTERM')

    expect(exit).toHaveBeenCalledWith(0)
    expect([...adapters.values()].map((adapter) => adapter.disconnects)).toEqual([1, 1])
    await expect(fetch(`${base}/webhooks/line`, { method: 'POST' })).rejects.toThrow()
  })

  it('a signal during server initialization stops runners and closes the server', async () => {
    const listening = deferred<void>()
    const { listen, calls } = heldListen(listening.promise)
    const { adapters, builders } = fakeBuilders()
    const signals = new EventEmitter()
    const exit = vi.fn()
    const starting = startTheoClaw({ env: TELEGRAM_AND_LINE, agentFactory: noAgent, builders, signals, exit, listen, streams: [capturingStream()] })
    await waitFor(() => adapters.size === 2 && [...adapters.values()].every((a) => a.connects === 1), 1000, 'both runners to connect')
    await new Promise((resolve) => setImmediate(resolve))

    signals.emit('SIGTERM')
    await waitFor(() => [...adapters.values()].every((adapter) => adapter.disconnects === 1), 1000, 'the runners to stop')
    expect(calls.closes).toBe(0)

    listening.resolve()
    running.push(await starting)
    await waitFor(() => exit.mock.calls.length === 1, 1000, 'exit after the server closed')
    expect(calls.closes).toBe(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('a signal while a connect is pending exits without waiting for it', async () => {
    const { builders } = fakeBuilders({ telegram: new FakeAdapter('telegram', { connect: () => new Promise<boolean>(() => {}) }) })
    const signals = new EventEmitter()
    const exit = vi.fn()
    const app = await startTheoClaw({ env: TELEGRAM_AND_LINE, agentFactory: noAgent, builders, signals, exit, streams: [capturingStream()], startTimeoutMs: 5000 })

    signals.emit('SIGTERM')

    await waitFor(() => exit.mock.calls.length === 1, 1000, 'exit while telegram is still connecting')
    expect(exit).toHaveBeenCalledWith(0)
    expect(app.loop.started.has('telegram')).toBe(false)
  })

  it('shutdown flushes the output mask', async () => {
    const { builders } = fakeBuilders()
    const signals = new EventEmitter()
    const capture = capturingStream()
    let atExit = ''
    const exit = vi.fn(() => {
      atExit = capture.text()
    })
    const app = await startTheoClaw({ env: TELEGRAM_AND_LINE, agentFactory: noAgent, builders, signals, exit, streams: [capture] })
    running.push(app)

    capture.write('token telegram-token-value\n')
    capture.write('last words telegram-tok')
    signals.emit('SIGTERM')
    await waitFor(() => exit.mock.calls.length === 1, 2000, 'exit after SIGTERM')

    expect(atExit).toContain('token [redacted]\n')
    expect(atExit).toContain('last words telegram-tok')
    expect(atExit).not.toContain('telegram-token-value')
  })

  it('a listen that fails stops the runners and rejects', async () => {
    const occupied = await listenControlPlane({ handler: async () => new Response(null), port: 0, host: '127.0.0.1', stderr: () => undefined })
    const { adapters, builders } = fakeBuilders()
    const signals = new EventEmitter()
    const env = { ...TELEGRAM_AND_LINE, THEOCLAW_PORT: String(occupied.address().port) }

    const starting = startTheoClaw({ env, agentFactory: noAgent, builders, signals, exit: vi.fn(), streams: [capturingStream()] })

    await expect(starting).rejects.toThrow(TheoClawBindError)
    await waitFor(
      () => [...adapters.values()].every((adapter) => adapter.disconnects === adapter.connects),
      1000,
      'every connected runner to be stopped',
    )
    expect(signals.listenerCount('SIGTERM')).toBe(0)
    await occupied.close()
  })

  it('masks the THEOKIT_API_KEY model key', async () => {
    const { builders } = fakeBuilders()
    const capture = capturingStream()
    const app = await startTheoClaw({
      env: { ...TELEGRAM_AND_LINE, THEOKIT_API_KEY: 'theokit-api-key-value' },
      agentFactory: noAgent,
      builders,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capture],
    })
    running.push(app)

    capture.write('failed with theokit-api-key-value\n')

    expect(capture.text()).toContain('failed with [redacted]\n')
    expect(capture.text()).not.toContain('theokit-api-key-value')
  })

  it('masks the OpenRouter model key and the control token', async () => {
    const { builders } = fakeBuilders()
    const capture = capturingStream()
    const token = 'control-token-value-0123456789abcdef'
    const app = await startTheoClaw({
      env: { ...TELEGRAM_AND_LINE, THEOCLAW_CONTROL_TOKEN: token },
      agentFactory: noAgent,
      builders,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capture],
    })
    running.push(app)

    capture.write(`key openrouter-key-value token ${token}\n`)

    expect(capture.text()).toContain('key [redacted] token [redacted]\n')
    expect(capture.text()).not.toContain('openrouter-key-value')
    expect(capture.text()).not.toContain(token)
  })

  it('serves /health and the webhook routes on the one listener', async () => {
    const { builders } = fakeBuilders()
    const capture = capturingStream()
    const app = await startTheoClaw({ env: TELEGRAM_AND_LINE, agentFactory: noAgent, builders, signals: new EventEmitter(), exit: vi.fn(), streams: [capture] })
    running.push(app)
    await app.loop.ready
    const base = `http://127.0.0.1:${app.address().port}`

    const health = await fetch(`${base}/health`)

    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok' })
    expect((await fetch(signedLinePost(base))).status).toBe(200)
    expect((await fetch(`${base}/webhooks/sms`, { method: 'POST' })).status).toBe(404)
    expect(capture.text()).toContain(`theoclaw: control plane listening on 127.0.0.1:${app.address().port}`)
  })

  it('refuses to start without a model', async () => {
    const { adapters, builders } = fakeBuilders()
    const { THEOCLAW_MODEL: _omitted, ...env } = TELEGRAM_AND_LINE

    const starting = startTheoClaw({ env, agentFactory: noAgent, builders, signals: new EventEmitter(), exit: vi.fn(), streams: [capturingStream()] })

    await expect(starting).rejects.toBeInstanceOf(TheoClawConfigError)
    await expect(starting).rejects.toThrow(/THEOCLAW_MODEL/)
    expect(adapters.size).toBe(0)
  })
})
