import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { startForTools, stop } from './tool-start-fixtures.js'

const TOKEN = 'mcp-relay-token-0123456789abcdef'

async function relayServer() {
  let polls = 0
  let inflight = 0
  const idle: (() => void)[] = []
  const server = createServer((req, res) => {
    inflight += 1
    res.on('close', () => {
      inflight -= 1
      if (inflight === 0) for (const wake of idle.splice(0)) wake()
    })
    req.resume()
    req.on('end', () => {
      if (req.url === '/instance/poll') polls += 1
      setTimeout(() => res.writeHead(200).end(JSON.stringify({ jobs: [] })), 20)
    })
  })
  const sockets = new Set<Socket>()
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    polls: () => polls,
    /** Resolves once no request is in flight and every connection has closed; the server keeps listening. */
    settled: async () => {
      if (inflight > 0) await new Promise<void>((r) => idle.push(r))
      const open = [...sockets].map((socket) => new Promise<void>((r) => socket.once('close', () => r())))
      server.closeIdleConnections()
      await Promise.all(open)
    },
    close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
  }
}

describe('the MCP relay in the composition', () => {
  it('starts only with both variables set, and the token never reaches the output', async () => {
    const relay = await relayServer()
    const cwd = mkdtempSync(join(tmpdir(), 'mcp-relay-'))
    const off = await startForTools({}, cwd, {})
    await new Promise((r) => setTimeout(r, 100))
    expect(off.output()).not.toContain('mcp-relay')
    await stop(off)
    expect(relay.polls()).toBe(0)

    const on = await startForTools({ THEOCLAW_MCP_RELAY_URL: relay.url, THEOCLAW_MCP_RELAY_TOKEN: TOKEN }, cwd, {})
    expect(on.error).toBeUndefined()
    for (let i = 0; i < 100 && relay.polls() === 0; i++) await new Promise((r) => setTimeout(r, 20))
    expect(relay.polls()).toBeGreaterThan(0)
    for (let i = 0; i < 100 && !on.output().includes('mcp-relay: connected'); i++) await new Promise((r) => setTimeout(r, 20))
    on.writeThrough(`leak ${TOKEN}`)
    expect(on.output()).toContain('mcp-relay: connected')
    expect(on.output()).not.toContain(TOKEN)
    await stop(on)
    await relay.settled()
    const seen = relay.polls()
    // The server still listens: a poll after stop would be counted here.
    await new Promise<void>((r) => setImmediate(r))
    expect(relay.polls()).toBe(seen)
    await relay.close()
    expect(relay.polls()).toBe(seen)
  })

  it('refuses a plain-http remote URL, naming the variable', async () => {
    const start = await startForTools({ THEOCLAW_MCP_RELAY_URL: 'http://relay.example', THEOCLAW_MCP_RELAY_TOKEN: TOKEN }, undefined, {})
    expect(start.error?.message).toContain('THEOCLAW_MCP_RELAY_URL')
  })
})
