import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SdkAgentHandle } from '../bridge/sdk-adapter.js'
import type { SdkMessage } from '../bridge/event-translator.js'
import * as entry from '../control-entry.js'
import { ControlConnectionError, createControlClient } from './control-client.js'
import { attachControlSocket } from './control-socket.js'
import { createSessionStore } from './session-store.js'

const CREDENTIAL = 'Bearer s3cret-credential-value'

const open: Array<{ close(): Promise<void> }> = []
const servers: Server[] = []

async function start(authorize: (header: string | undefined) => boolean): Promise<string> {
  const agent = {
    agentId: 'a',
    dispose: async () => {},
    send: async () => ({ cancel: async () => {}, wait: async () => ({ status: 'finished' }) }),
  } as unknown as SdkAgentHandle<SdkMessage>
  const server = createServer()
  servers.push(server)
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const sessions = createSessionStore({ build: vi.fn(async () => agent), drainMs: 50 })
  open.push(attachControlSocket(server, { authorize, sessions }), sessions)
  return `ws://127.0.0.1:${(server.address() as AddressInfo).port}/control`
}

afterEach(async () => {
  for (const h of open.splice(0)) await h.close()
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r))
})

describe('createControlClient', () => {
  it('is exported from the control entry', () => {
    expect(entry.createControlClient).toBe(createControlClient)
    expect(entry.ControlConnectionError).toBe(ControlConnectionError)
  })

  it('a non ws url is refused with ControlConnectionError', async () => {
    const error: unknown = await createControlClient({
      url: 'http://127.0.0.1:1/control',
      authorization: CREDENTIAL,
    }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ControlConnectionError)
    expect((error as Error).message).toBe('the address must start with ws:// or wss://')
  })

  it('a refused upgrade names the HTTP status and never the credential', async () => {
    const url = await start(() => false)
    const error: unknown = await createControlClient({ url, authorization: CREDENTIAL }).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(ControlConnectionError)
    const { message } = error as Error
    expect(message).toContain('HTTP 401')
    expect(message).not.toContain('s3cret-credential-value')
  })

  it('chat yields frames until done', async () => {
    const url = await start((h) => h === CREDENTIAL)
    const client = await createControlClient({ url, authorization: CREDENTIAL })
    const frames = []
    for await (const frame of client.chat('hi', 's1')) frames.push(frame)
    expect(frames.at(-1)).toMatchObject({ type: 'done', session: 's1' })
    // a second turn on the same connection works
    const again = []
    for await (const frame of client.chat('again', 's1')) again.push(frame)
    expect(again.at(-1)?.type).toBe('done')
    expect(() => {
      client.interrupt('s1')
    }).not.toThrow()
    await client.close()
    expect(() => {
      client.steer('s1', 'x')
    }).toThrow(ControlConnectionError)
  })

  it('yields acknowledgements unless dropAcknowledgements is set', async () => {
    const url = await start((h) => h === CREDENTIAL)
    for (const drop of [false, true]) {
      const client = await createControlClient({
        url,
        authorization: CREDENTIAL,
        dropAcknowledgements: drop,
      })
      const seen: string[] = []
      for await (const frame of client.chat('hi', 's1')) {
        if (frame.type !== 'done') client.interrupt('s1')
        seen.push(frame.type)
      }
      expect(seen.at(-1)).toBe('done')
      if (drop)
        expect(seen.filter((t) => ['interrupt_ok', 'steer_ok', 'no_turn'].includes(t))).toEqual([])
      await client.close()
    }
  })

  it('a 1009 close rejects the iteration with the frame limit message', async () => {
    const url = await start(() => true)
    const client = await createControlClient({ url, authorization: CREDENTIAL })
    const run = async (): Promise<void> => {
      for await (const _frame of client.chat('x'.repeat(70_000), 's1')) continue
    }
    await expect(run()).rejects.toThrow(
      'the chat frame exceeds the 65,536-byte frame limit of the instance',
    )
    await client.close()
  })
})
