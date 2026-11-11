import { EventEmitter } from 'node:events'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createInfoCommandHook,
  infoCommandReply,
  withWebchatCommands,
  type ActiveTurns,
} from '../src/channels/info-commands.js'
import type { RunningTheoClaw } from '../src/composition.js'
import { startTheoClaw } from '../src/composition.js'
import type { TurnAgent, TurnEvent, TurnRun, TurnRunner } from '../src/control-plane/turn.js'
import { capturingStream, fakeBuilders, TELEGRAM_AND_LINE } from './composition-fixtures.js'
import { assistant, finished, messageEvent } from './fakes.js'

const TOKEN = 'webchat-token-value-0123456789abcdef'

const running: RunningTheoClaw[] = []
afterEach(async () => {
  for (const app of running.splice(0)) {
    await app.loop.stopAll()
    await app.close()
  }
})

function commands(inner: TurnRunner, compact = async () => 'compacted') {
  const emitted: TurnEvent[] = []
  const run = withWebchatCommands(inner, { model: 'a/b', chatId: 'c1', active: new Map() as ActiveTurns, compact })
  return { emitted, run: (m: string) => run(m, (e) => emitted.push(e)) }
}

describe('/model, /status and /think (OC-105)', () => {
  it('answer with the model, /model only when bare', () => {
    expect(infoCommandReply('/model', { model: 'a/b' })).toBe('Model: a/b')
    expect(infoCommandReply('/status', { model: 'a/b' })).toContain('Model: a/b')
    expect(infoCommandReply('/think', { model: 'a/b', thinking: 'high' })).toContain('high')
    expect(infoCommandReply('hello', { model: 'a/b' })).toBeUndefined()
  })

  it('block on a channel', async () => {
    const hook = createInfoCommandHook({ model: 'a/b' })
    const decision = await hook.pre_inbound?.({ event: messageEvent('telegram', '/model') } as never)
    expect(decision).toMatchObject({ block: true, message: 'Model: a/b' })
  })
})

describe('WebChat commands', () => {
  it('answer /help, /compact without a model turn and pass other text through', async () => {
    const seen: string[] = []
    const { emitted, run } = commands(async (m) => (seen.push(m), { ok: true }))
    await run('/help')
    await run('/compact')
    expect(JSON.stringify(emitted)).toContain('/steer')
    expect(JSON.stringify(emitted)).toContain('compacted')
    await run('hi')
    expect(seen).toEqual(['hi'])
  })

  it('/stop cancels the running turn; /steer replaces it with the new message', async () => {
    const active: ActiveTurns = new Map()
    const aborted: string[] = []
    const inner: TurnRunner = (message, _emit, signal) =>
      new Promise((resolve) => {
        if (message === 'second') return resolve({ ok: true })
        signal?.addEventListener('abort', () => (aborted.push(message), resolve({ ok: false, code: 'turn_cancelled', reason: 'x' })))
      })
    const run = withWebchatCommands(inner, { model: 'a/b', chatId: 'c1', active, compact: async () => '' })
    const out: TurnEvent[] = []
    const first = run('first', (e) => out.push(e))
    expect(await run('/stop', (e) => out.push(e))).toEqual({ ok: true })
    expect(await first).toMatchObject({ code: 'turn_cancelled' })
    expect(await run('/stop', (e) => out.push(e))).toEqual({ ok: true })
    expect(JSON.stringify(out)).toContain('Nothing is running.')
    const third = run('third', () => undefined)
    expect(await run('/steer second', () => undefined)).toEqual({ ok: true })
    expect(await third).toMatchObject({ code: 'turn_cancelled' })
    expect(aborted).toEqual(['first', 'third'])
    expect(active.size).toBe(0)
  })
})

describe('the composed WebChat', () => {
  it('answers /model and /compact with no model turn and no usage', async () => {
    let sends = 0
    const factory = (): TurnAgent => ({
      async send(): Promise<TurnRun> {
        sends += 1
        return {
          async *stream() {
            yield assistant('from the model')
            yield finished()
          },
          wait: async () => ({ status: 'finished' }),
          cancel: async () => undefined,
        }
      },
      async [Symbol.asyncDispose]() {},
    } as TurnAgent)
    const { builders } = fakeBuilders()
    const app = await startTheoClaw({
      env: { ...TELEGRAM_AND_LINE, THEOCLAW_WEBCHAT_TOKEN: TOKEN },
      agentFactory: () => {
        throw new Error('a WebChat turn built a /control agent')
      },
      getOrCreate: async () => Object.assign(factory(), { dispose: async () => undefined }) as never,
      compact: async () => ({ preTokens: 9, postTokens: 3 }),
      builders,
      signals: new EventEmitter(),
      exit: vi.fn(),
      streams: [capturingStream()],
      webchatAssetsDir: mkdtempSync(join(tmpdir(), 'theoclaw-webchat-info-')),
    })
    running.push(app)
    const post = async (message: string): Promise<string> => {
      const response = await fetch(`http://127.0.0.1:${app.address().port}/webchat/chat`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message, id: 'chat-1' }),
      })
      return response.text()
    }

    const model = await post('/model')
    expect(model).toContain(`Model: ${TELEGRAM_AND_LINE.THEOCLAW_MODEL}`)
    expect(model).not.toContain('usage')
    expect(await post('/compact')).toContain('Compacted (9 → 3 tokens)')
    expect(await post('/stop')).toContain('Nothing is running.')
    expect(sends).toBe(0)
    // A real turn, by contrast, carries its usage.
    expect(await post('hello')).toContain('"usage"')
    expect(sends).toBe(1)
  })
})
