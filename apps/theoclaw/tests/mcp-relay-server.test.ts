import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { runCli } from '../src/cli.js'
import { GrantStore, grantsPath } from '../src/mcp-relay/grants.js'
import { createMcpRelay } from '../src/mcp-relay/relay-server.js'
import { harness } from './support/cli-harness.js'

const INSTANCE = 'i'.repeat(40)
const servers: { close: () => void }[] = []
afterEach(() => servers.splice(0).forEach((s) => s.close()))

async function setup(timeoutMs = 2000) {
  const v = harness()
  const path = grantsPath(v.io.env, v.io.homeDir)
  mkdirSync(dirname(path), { recursive: true })
  const store = new GrantStore(path)
  const { token } = store.create('chatgpt', ['list_dir'])
  const server = createMcpRelay({
    instanceToken: INSTANCE,
    grantsPath: path,
    timeoutMs,
    pollMs: 300,
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  servers.push({
    close: () => {
      server.closeAllConnections()
      server.close()
    },
  })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (p: string, bearer: string, body: unknown) =>
    fetch(base + p, {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}` },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  return { base, post, token, store, path }
}

const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list' }

describe('mcp-relay server', () => {
  it('delivers a job to the poller and returns the response', async () => {
    const r = await setup()
    const poll = r.post('/instance/poll', INSTANCE, {})
    const client = r.post('/mcp', r.token, rpc)
    const { jobs } = (await (await poll).json()) as {
      jobs: { id: string; client: string; allowedTools: string[]; body: unknown }[]
    }
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ client: 'chatgpt', allowedTools: ['list_dir'], body: rpc })
    const answer = { jsonrpc: '2.0', id: 1, result: { tools: [] } }
    expect(
      (await r.post('/instance/respond', INSTANCE, { id: jobs[0]!.id, response: answer })).status,
    ).toBe(204)
    const res = await client
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(answer)
    expect(
      (await r.post('/instance/respond', INSTANCE, { id: 'nope', response: answer })).status,
    ).toBe(404)
  })

  it('rejects wrong and revoked client tokens without enqueueing', async () => {
    const r = await setup()
    const bad = await r.post('/mcp', 'wrong', rpc)
    expect(bad.status).toBe(401)
    expect(bad.headers.get('www-authenticate')).toBe('Bearer')
    r.store.revoke('chatgpt')
    expect((await r.post('/mcp', r.token, rpc)).status).toBe(401)
    const polled = (await (await r.post('/instance/poll', INSTANCE, {})).json()) as {
      jobs: unknown[]
    }
    expect(polled.jobs).toEqual([])
  })

  it('guards /instance/* with the instance token only', async () => {
    const r = await setup()
    expect((await r.post('/instance/poll', 'wrong', {})).status).toBe(401)
    expect((await r.post('/instance/poll', r.token, {})).status).toBe(401)
    expect((await r.post('/instance/respond', r.token, { id: 'x', response: {} })).status).toBe(401)
  })

  it('answers 504 with no instance, 202 for a notification, 413 when oversized', async () => {
    const r = await setup(100)
    expect((await r.post('/mcp', r.token, rpc)).status).toBe(504)
    expect(
      (await r.post('/mcp', r.token, { jsonrpc: '2.0', method: 'notifications/initialized' }))
        .status,
    ).toBe(202)
    expect((await r.post('/mcp', r.token, 'x'.repeat(300 * 1024))).status).toBe(413)
    writeFileSync(r.path, '{bad')
    expect((await r.post('/mcp', r.token, rpc)).status).toBe(401)
  })
})

describe('theoclaw mcp-relay serve', () => {
  it('exits 1 without the instance token', async () => {
    const v = harness()
    expect(await runCli(['mcp-relay', 'serve', '--port', '0'], v.io)).toBe(1)
    expect(v.stderr()).toContain('THEOCLAW_MCP_RELAY_TOKEN')
  })

  it('serves over HTTP until signalled', async () => {
    const v = harness()
    const io = { ...v.io, env: { ...v.io.env, THEOCLAW_MCP_RELAY_TOKEN: INSTANCE } }
    const done = runCli(['mcp-relay', 'serve', '--port', '0'], io)
    let port: string | undefined
    for (let i = 0; i < 100 && port === undefined; i++) {
      port = /127\.0\.0\.1:(\d+)/.exec(v.stdout())?.[1]
      if (port === undefined) await new Promise((r) => setTimeout(r, 20))
    }
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    v.signals.emit('SIGTERM')
    expect(await done).toBe(0)
  })
})
