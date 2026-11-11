import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { createMcpRelayServer, MAX_BODY_BYTES } from '../src/mcp-relay/relay-server.js'
import { harness } from './support/cli-harness.js'

const INSTANCE = 'i'.repeat(40)
const CLIENT = 'c'.repeat(40)
const sha = (t: string): string => createHash('sha256').update(t).digest('hex')
const closers: (() => void)[] = []
afterEach(() => closers.splice(0).forEach((c) => c()))

function grantsFile(dir: string, grants: unknown[]): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'mcp-relay-grants.json')
  writeFileSync(path, JSON.stringify({ grants }))
  return path
}

async function start(timeoutMs = 5000, grants?: unknown[]) {
  const dir = join(
    process.env['TMPDIR'] ?? '/tmp',
    `mcp-relay-${Math.random().toString(36).slice(2)}`,
  )
  const path = grantsFile(
    dir,
    grants ?? [
      { id: '1', name: 'alice', tokenHash: sha(CLIENT), tools: ['a', 'b'], createdAt: 'x' },
      {
        id: '2',
        name: 'bob',
        tokenHash: sha('r'.repeat(40)),
        tools: [],
        createdAt: 'x',
        revokedAt: 'y',
      },
    ],
  )
  const server = createMcpRelayServer({
    instanceToken: INSTANCE,
    grantsPath: path,
    timeoutMs,
    pollMs: 200,
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  closers.push(() => {
    server.closeAllConnections()
    server.close()
  })
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const post = (p: string, token: string | null, body: unknown) =>
    fetch(base + p, {
      method: 'POST',
      headers: { ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  return { base, post }
}

describe('mcp relay server', () => {
  it('delivers a client call to the poller and returns the response', async () => {
    const { post } = await start()
    const call = post('/mcp', CLIENT, { jsonrpc: '2.0', id: 7, method: 'tools/list' })
    const polled = (await (await post('/instance/poll', INSTANCE, {})).json()) as {
      jobs: { id: string; client: string; allowedTools: string[]; body: unknown }[]
    }
    expect(polled.jobs).toHaveLength(1)
    const job = polled.jobs[0]!
    expect(job.client).toBe('alice')
    expect(job.allowedTools).toEqual(['a', 'b'])
    expect(job.body).toMatchObject({ method: 'tools/list' })
    const ok = await post('/instance/respond', INSTANCE, {
      id: job.id,
      response: { jsonrpc: '2.0', id: 7, result: {} },
    })
    expect(ok.status).toBeLessThan(300)
    const res = await call
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 7, result: {} })
    expect((await post('/instance/respond', INSTANCE, { id: job.id, response: {} })).status).toBe(
      404,
    )
  })

  it('refuses a wrong or revoked client token and enqueues nothing', async () => {
    const { post } = await start()
    expect((await post('/mcp', 'w'.repeat(40), { id: 1 })).status).toBe(401)
    const revoked = await post('/mcp', 'r'.repeat(40), { id: 1 })
    expect(revoked.status).toBe(401)
    expect(revoked.headers.get('www-authenticate')).toBe('Bearer')
    const polled = (await (await post('/instance/poll', INSTANCE, {})).json()) as {
      jobs: unknown[]
    }
    expect(polled.jobs).toEqual([])
  })

  it('refuses a wrong instance token and a client token on /instance/*', async () => {
    const { post } = await start()
    expect((await post('/instance/poll', 'x'.repeat(40), {})).status).toBe(401)
    expect((await post('/instance/respond', CLIENT, { id: 'a', response: {} })).status).toBe(401)
    expect((await post('/instance/poll', null, {})).status).toBe(401)
  })

  it('answers 504 when no instance answers, and 202 to a notification', async () => {
    const { post } = await start(100)
    expect((await post('/mcp', CLIENT, { jsonrpc: '2.0', id: 1, method: 'x' })).status).toBe(504)
    expect(
      (await post('/mcp', CLIENT, { jsonrpc: '2.0', method: 'notifications/initialized' })).status,
    ).toBe(202)
  })

  it('answers 413 to an oversized body', async () => {
    const { post } = await start()
    expect((await post('/mcp', CLIENT, 'x'.repeat(MAX_BODY_BYTES + 1))).status).toBe(413)
    expect((await post('/instance/respond', INSTANCE, 'x'.repeat(MAX_BODY_BYTES + 1))).status).toBe(
      413,
    )
  })
})

describe('theoclaw mcp-relay serve', () => {
  it('fails without THEOCLAW_MCP_RELAY_TOKEN', async () => {
    const v = harness()
    const code = await runCli(['mcp-relay', 'serve', '--port', '0'], {
      ...v.io,
      env: { ...v.io.env, THEOCLAW_STATE_DIR: v.io.cwd },
    }).catch(() => 1)
    expect(code).not.toBe(0)
  })

  it('serves over HTTP until a signal', async () => {
    const v = harness()
    const state = join(v.io.cwd, 'st')
    grantsFile(state, [
      { id: '1', name: 'alice', tokenHash: sha(CLIENT), tools: [], createdAt: 'x' },
    ])
    const done = runCli(['mcp-relay', 'serve', '--port', '0'], {
      ...v.io,
      env: { ...v.io.env, THEOCLAW_MCP_RELAY_TOKEN: INSTANCE, THEOCLAW_STATE_DIR: state },
    })
    for (let i = 0; i < 100 && !v.stdout().includes('listening'); i++)
      await new Promise((r) => setTimeout(r, 20))
    const port = /:(\d+)\n/.exec(v.stdout())![1]
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: '{}' })
    expect(res.status).toBe(401)
    v.signals.emit('SIGTERM', 'SIGTERM')
    expect(await done).toBe(0)
  })
})
