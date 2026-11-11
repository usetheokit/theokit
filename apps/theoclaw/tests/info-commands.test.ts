import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createInfoCommandHook, infoCommandReply, withInfoCommands } from '../src/channels/info-commands.js'
import type { TurnEvent, TurnRunner } from '../src/control-plane/turn.js'
import { createWebchatRoutes } from '../src/webchat/routes.js'
import { messageEvent } from './fakes.js'

const TOKEN = 'w'.repeat(40)

describe('/model and /status (OC-105)', () => {
  it('answer with the model, only for the bare command', () => {
    expect(infoCommandReply('/model', { model: 'a/b' })).toBe('Model: a/b')
    expect(infoCommandReply('/status', { model: 'a/b' })).toContain('Model: a/b')
    expect(infoCommandReply('/model gpt', { model: 'a/b' })).toBeUndefined()
    expect(infoCommandReply('hello', { model: 'a/b' })).toBeUndefined()
  })

  it('block on a channel', async () => {
    const hook = createInfoCommandHook({ model: 'a/b' })
    const decision = await hook.pre_inbound?.({ event: messageEvent('telegram', '/model') } as never)
    expect(decision).toMatchObject({ block: true, message: 'Model: a/b' })
  })

  it('answer in WebChat without a model turn or a usage line', async () => {
    let turns = 0
    const inner: TurnRunner = async () => {
      turns += 1
      return { ok: true }
    }
    const handle = createWebchatRoutes({
      token: TOKEN,
      turnFor: () => withInfoCommands(inner, { model: 'a/b' }),
      assetsDir: mkdtempSync(join(tmpdir(), 'theoclaw-info-')),
    })
    const response = await handle(
      new Request('http://127.0.0.1/webchat/chat', {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message: '/model', chatId: 'c1', sessionId: 'c1' }),
      }),
    )
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toContain('Model: a/b')
    expect(body).not.toContain('"usage"')
    expect(turns).toBe(0)
  })

  it('pass other messages through', async () => {
    const seen: string[] = []
    const emitted: TurnEvent[] = []
    await withInfoCommands(async (m) => (seen.push(m), { ok: true }), { model: 'a/b' })('hi', (e) => emitted.push(e))
    expect(seen).toEqual(['hi'])
    expect(emitted).toEqual([])
  })
})
