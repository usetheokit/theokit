import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RunningTheoClaw } from '../src/composition.js'
import { startTheoClaw } from '../src/composition.js'
import type { TurnAgent, TurnRun } from '../src/control-plane/turn.js'
import { capturingStream, fakeBuilders, TELEGRAM_AND_LINE } from './composition-fixtures.js'
import { assistant, waitFor } from './fakes.js'

const TOKEN = 'webchat-token-value-0123456789abcdef'

const running: RunningTheoClaw[] = []
afterEach(async () => {
  for (const app of running.splice(0)) {
    await app.loop.stopAll()
    await app.close()
  }
})

/** An agent whose run streams one message and then nothing: a model that went silent. */
function silentAgentFactory() {
  const calls = { cancels: 0, disposed: 0 }
  const factory = (): TurnAgent => {
    // Disposable, as the SDK agent is: the request boundary disposes it when the turn ends.
    const agent = {
      async send(): Promise<TurnRun> {
        return {
          async *stream() {
            yield assistant('first words')
            await new Promise(() => undefined)
          },
          wait: async () => ({ status: 'finished' }),
          cancel: async () => {
            calls.cancels += 1
          },
        }
      },
      async [Symbol.asyncDispose]() {
        calls.disposed += 1
      },
    }
    return agent
  }
  return { calls, factory }
}

/** AC-004 (B-368): a client that leaves mid-turn cancels the SDK run through the real listener. */
describe('a WebChat client that disconnects mid-turn', () => {
  it('makes the run cancel once and the request boundary settle within 1000 ms', async () => {
    const { calls, factory } = silentAgentFactory()
    const { builders } = fakeBuilders()
    const app = await startTheoClaw({
      env: { ...TELEGRAM_AND_LINE, THEOCLAW_WEBCHAT_TOKEN: TOKEN },
      agentFactory: factory,
      builders,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capturingStream()],
      webchatAssetsDir: mkdtempSync(join(tmpdir(), 'theoclaw-webchat-abort-')),
    })
    running.push(app)
    const client = new AbortController()

    const response = await fetch(`http://127.0.0.1:${app.address().port}/webchat/chat`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
      signal: client.signal,
    })
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    while (!seen.includes('first words')) {
      const { done, value } = await reader.read()
      if (done) throw new Error('the body ended before the first words')
      seen += decoder.decode(value, { stream: true })
    }
    client.abort()

    await waitFor(
      () => calls.cancels === 1 && calls.disposed === 1,
      1000,
      'the run cancelled and its agent disposed',
    )
    expect(calls.cancels).toBe(1)
  })
})
