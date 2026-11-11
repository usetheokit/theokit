import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'

import type { CustomTool } from '@theokit/sdk'
import { afterEach, describe, expect, it } from 'vitest'

import { mcpRelaySecrets, readMcpRelaySettings, startMcpRelayConnector, type McpRelayConnector, type McpRelayJob } from '../src/mcp-relay/connector.js'
import { buildTools } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { cleanScratch, harness } from './support/cli-harness.js'

const TOKEN = 'mcp-relay-token-0123456789abcdef'
const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  cleanScratch()
})

const call = (name: string, args: unknown) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })

interface FakeRelay {
  readonly url: string
  readonly responses: Array<{ id: string; response: any }>
  readonly auth: string[]
  readonly polls: () => number
  readonly queue: (job: McpRelayJob) => void
  readonly failNext: (mode: 500 | 'drop', times?: number) => void
  readonly answered: (id: string) => Promise<any>
}

async function fakeRelay(): Promise<FakeRelay> {
  const jobs: McpRelayJob[] = []
  const responses: FakeRelay['responses'] = []
  const auth: string[] = []
  const failures: Array<500 | 'drop'> = []
  let polls = 0
  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      auth.push(String(req.headers.authorization))
      const failure = failures.shift()
      if (failure === 'drop') return void req.socket.destroy()
      if (failure === 500) return void res.writeHead(500).end()
      if (req.url === '/instance/poll') {
        polls += 1
        const send = () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jobs: jobs.splice(0) }))
        if (jobs.length > 0) return send()
        return void setTimeout(send, 20)
      }
      if (req.url === '/instance/respond') responses.push(JSON.parse(raw))
      res.writeHead(200).end('{}')
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  closers.push(() => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))))
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    responses,
    auth,
    polls: () => polls,
    queue: (job) => void jobs.push(job),
    failNext: (mode, times = 1) => void failures.push(...Array<500 | 'drop'>(times).fill(mode)),
    answered: async (id) => {
      for (let i = 0; i < 300; i++) {
        const hit = responses.find((r) => r.id === id)
        if (hit !== undefined) return hit.response
        await new Promise((r) => setTimeout(r, 10))
      }
      throw new Error(`no answer for ${id}`)
    },
  }
}

function connect(relay: FakeRelay, tools?: () => readonly CustomTool[]) {
  const h = harness()
  const toolSettings = resolveToolSettings({}, h.io.cwd)
  writeFileSync(join(toolSettings.toolRoot, 'hello.txt'), 'hi')
  mkdirSync(join(h.io.cwd, '.theoclaw'), { recursive: true })
  const logs: string[] = []
  const connector: McpRelayConnector = startMcpRelayConnector({
    settings: { url: relay.url, token: TOKEN },
    controlTools: tools ?? (() => buildTools(toolSettings)),
    toolSettings,
    log: (l) => logs.push(l),
    backoffMs: { min: 5, max: 20 },
  })
  closers.push(() => connector.stop())
  return { connector, logs }
}

describe('MCP relay connector', () => {
  it('answers an allowed tools/call through /instance/respond', async () => {
    const relay = await fakeRelay()
    const { logs } = connect(relay)
    relay.queue({ id: 'a', client: 'c', allowedTools: ['list_dir'], body: call('list_dir', { path: '.' }) })
    expect(JSON.stringify(await relay.answered('a'))).toContain('hello.txt')
    expect(new Set(relay.auth)).toEqual(new Set([`Bearer ${TOKEN}`]))
    expect(logs).toEqual(['mcp-relay: connected'])
  })

  it('refuses a tool outside allowedTools without running its handler', async () => {
    const relay = await fakeRelay()
    let ran = 0
    connect(relay, () => buildTools(resolveToolSettings({}, process.cwd())).map((t) => (t.name === 'list_dir' ? ({ ...t, handler: () => (ran++, 'x') } as CustomTool) : t)))
    relay.queue({ id: 'b', client: 'c', allowedTools: ['read_file'], body: call('list_dir', { path: '.' }) })
    const response = await relay.answered('b')
    expect(response.error ?? response.result?.isError).toBeTruthy()
    expect(ran).toBe(0)
  })

  it('lists only the allowed tools, and all of them for null', async () => {
    const relay = await fakeRelay()
    connect(relay)
    const list = { jsonrpc: '2.0', id: 2, method: 'tools/list' }
    relay.queue({ id: 'l1', client: 'c', allowedTools: ['list_dir'], body: list })
    relay.queue({ id: 'l2', client: 'c', allowedTools: null, body: list })
    const names = (r: any) => r.result.tools.map((t: { name: string }) => t.name)
    expect(names(await relay.answered('l1'))).toEqual(['list_dir'])
    expect(names(await relay.answered('l2')).length).toBeGreaterThan(1)
  })

  it('vetoes a path inside the state directory', async () => {
    const relay = await fakeRelay()
    connect(relay)
    relay.queue({ id: 'v', client: 'c', allowedTools: null, body: call('list_dir', { path: '../.theoclaw' }) })
    expect(JSON.stringify(await relay.answered('v'))).toContain('.theoclaw directory')
  })

  it('retries after a 500 and a dropped connection, then answers a later job', async () => {
    const relay = await fakeRelay()
    relay.failNext(500)
    relay.failNext('drop')
    const { logs } = connect(relay)
    await new Promise((r) => setTimeout(r, 100))
    relay.queue({ id: 'late', client: 'c', allowedTools: ['list_dir'], body: call('list_dir', { path: '.' }) })
    expect(JSON.stringify(await relay.answered('late'))).toContain('hello.txt')
    expect(logs.join('\n')).not.toContain(TOKEN)
  })

  it('stops polling once aborted', async () => {
    const relay = await fakeRelay()
    const { connector } = connect(relay)
    await new Promise((r) => setTimeout(r, 60))
    await connector.stop()
    const seen = relay.polls()
    await new Promise((r) => setTimeout(r, 80))
    expect(relay.polls()).toBe(seen)
  })
})

describe('MCP relay settings', () => {
  it('is off unless both are set, and its token is a secret', () => {
    expect(readMcpRelaySettings({})).toBeUndefined()
    const s = readMcpRelaySettings({ THEOCLAW_MCP_RELAY_URL: 'https://r.example/', THEOCLAW_MCP_RELAY_TOKEN: TOKEN })
    expect(s).toEqual({ url: 'https://r.example', token: TOKEN })
    expect(mcpRelaySecrets(s)).toEqual([TOKEN])
    expect(() => readMcpRelaySettings({ THEOCLAW_MCP_RELAY_URL: 'https://r.example' })).toThrow(/THEOCLAW_MCP_RELAY_TOKEN/)
  })

  it('rejects a non-https, non-loopback URL naming the variable', () => {
    expect(() => readMcpRelaySettings({ THEOCLAW_MCP_RELAY_URL: 'http://r.example', THEOCLAW_MCP_RELAY_TOKEN: TOKEN })).toThrow(/THEOCLAW_MCP_RELAY_URL/)
    expect(readMcpRelaySettings({ THEOCLAW_MCP_RELAY_URL: 'http://127.0.0.1:9', THEOCLAW_MCP_RELAY_TOKEN: TOKEN })).toBeDefined()
  })
})
