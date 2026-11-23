import type { AddressInfo } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createGrantStore } from '@theokit/http/guards'
import { afterEach, describe, expect, it } from 'vitest'

import { createMcpRelayServer, startMcpRelayConnector } from '../../src/mcp-relay-entry.js'

const tools = [{ name: 'read_file' }, { name: 'write_file' }]
const dispatch = async (visible: readonly { name: string }[], body: unknown): Promise<unknown> => {
  if (Array.isArray(body)) return Promise.all(body.map((b) => dispatch(visible, b)))
  const req = body as { id: number; method: string; params?: { name: string } }
  if (req.method === 'tools/list') return { jsonrpc: '2.0', id: req.id, result: { tools: visible } }
  const ok = visible.some((t) => t.name === req.params?.name)
  return ok
    ? { jsonrpc: '2.0', id: req.id, result: { ran: req.params?.name } }
    : { jsonrpc: '2.0', id: req.id, error: { code: -32602, message: 'unknown tool' } }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function setup() {
  const grants = createGrantStore(join(mkdtempSync(join(tmpdir(), 'relay-')), 'g.json'))
  const server = createMcpRelayServer({ instanceToken: 'i'.repeat(32), grants, pollMs: 200 })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const connector = startMcpRelayConnector({
    url,
    token: 'i'.repeat(32),
    tools: () => tools,
    dispatch,
  })
  cleanups.push(async () => {
    await connector.stop()
    server.closeAllConnections()
    await new Promise((r) => server.close(r))
  })
  const call = (credential: string, body: unknown) =>
    fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credential}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { grants, call, server }
}

describe('mcp relay', () => {
  it('lists and runs only what the grant allows', async () => {
    const { grants, call } = await setup()
    const { credential } = await grants.create('alice', ['read_file'])
    const list = await call(credential, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(((await list.json()) as { result: { tools: unknown[] } }).result.tools).toEqual([
      { name: 'read_file' },
    ])
    const denied = await call(credential, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'write_file' },
    })
    expect(((await denied.json()) as { error?: unknown }).error).toBeDefined()
    const ran = await call(credential, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'read_file' },
    })
    expect(((await ran.json()) as { result: unknown }).result).toEqual({ ran: 'read_file' })
  })

  it('refuses unknown and revoked credentials', async () => {
    const { grants, call } = await setup()
    const { credential } = await grants.create('bob', ['read_file'])
    expect((await call('wrong', { id: 1 })).status).toBe(401)
    await grants.revoke('bob')
    expect((await call(credential, { id: 1 })).status).toBe(401)
  })

  it('answers a batch with only the allowed tools, and 202 for a notification-only batch', async () => {
    const { grants, call } = await setup()
    const { credential } = await grants.create('carol', ['read_file'])
    const note = await call(credential, [{ jsonrpc: '2.0', method: 'notifications/x' }])
    expect(note.status).toBe(202)
    const batch = await call(credential, [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'write_file' } },
    ])
    const out = (await batch.json()) as Array<{ result?: { tools: unknown[] }; error?: unknown }>
    expect(out[0]?.result?.tools).toEqual([{ name: 'read_file' }])
    expect(out[1]?.error).toBeDefined()
  })

  it('answers 503 once the queue is full', async () => {
    const grants = createGrantStore(join(mkdtempSync(join(tmpdir(), 'relay-')), 'g.json'))
    const server = createMcpRelayServer({
      instanceToken: 'i'.repeat(32),
      grants,
      maxQueued: 1,
      timeoutMs: 300,
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    cleanups.push(async () => {
      server.closeAllConnections()
      await new Promise((r) => server.close(r))
    })
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`
    const { credential } = await grants.create('d', ['read_file'])
    const send = () =>
      fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${credential}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
    const first = send()
    await new Promise((r) => setTimeout(r, 50))
    expect((await send()).status).toBe(503)
    expect((await first).status).toBe(504)
  })
})
