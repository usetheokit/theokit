import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { createTheoClawAgent } from '../src/agent/create-agent.js'
import { ordersCommand } from '../src/agent/standing-orders.js'
import type { TurnAgent } from '../src/agent-port.js'
import { createControlSessions } from '../src/control-plane/control-sessions.js'
import { sessionAgentOptions } from '../src/control-plane/agent-factory.js'
import { UsageError } from '../src/cli-args.js'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function orders(workspace: string, ...args: string[]): string {
  const stdout = new PassThrough()
  const chunks: Buffer[] = []
  stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  ordersCommand(args, { env: { THEOCLAW_WORKSPACE: workspace }, homeDir: '/nonexistent', stdout })
  return Buffer.concat(chunks).toString()
}

function sse(text: string): string {
  const chunk = (delta: Record<string, unknown>, finish: string | null): string =>
    `data: ${JSON.stringify({ id: 'stub', object: 'chat.completion.chunk', created: 0, model: 'stub', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  return chunk({ role: 'assistant', content: text }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n'
}

describe('standing orders (#1614)', () => {
  it('adds, lists and removes orders', () => {
    const ws = mkdtempSync(join(tmpdir(), 'orders-'))
    cleanups.push(() => rmSync(ws, { recursive: true, force: true }))
    expect(orders(ws, 'list')).toBe('no standing orders\n')
    orders(ws, 'add', 'end every reply with', 'the word OVER')
    orders(ws, 'add', 'be brief')
    expect(orders(ws, 'list')).toBe('1. end every reply with the word OVER\n2. be brief\n')
    orders(ws, 'remove', '1')
    expect(orders(ws, 'list')).toBe('1. be brief\n')
    expect(() => orders(ws, 'remove', '5')).toThrow(UsageError)
    expect(() => orders(ws, 'add')).toThrow(UsageError)
  })

  it('reaches the model of a real SDK turn in a new session until removed', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'orders-'))
    cleanups.push(() => rmSync(ws, { recursive: true, force: true }))
    const bodies: string[] = []
    const server = createServer((request, response) => {
      let raw = ''
      request.on('data', (data: Buffer) => (raw += data.toString()))
      request.on('end', () => {
        bodies.push(raw)
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.end(sse('ok'))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    cleanups.push(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }))
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
    const turn = async (id: string): Promise<string> => {
      const options = { ...sessionAgentOptions({ THEOCLAW_MODEL: 'm', THEOKIT_API_KEY: 'stub-key' }, ws), model: { id: 'lmstudio/stub', url } }
      const sessions = createControlSessions({
        build: async () => (await createTheoClawAgent(options as never)) as TurnAgent,
        report: () => undefined,
      })
      cleanups.push(() => sessions.close())
      expect(await sessions.run(id, 'hello', () => undefined, {})).toEqual({ ok: true })
      return bodies.at(-1) ?? ''
    }
    orders(ws, 'add', 'end every reply with the word OVER')
    expect(await turn('s1')).toContain('end every reply with the word OVER')
    orders(ws, 'remove', '1')
    expect(await turn('s2')).not.toContain('end every reply with the word OVER')
  })
})
