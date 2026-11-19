/**
 * #1783: does `@theokit/sdk` honour an HTTP MCP server's `auth`? These tests drive a real SDK agent,
 * built from TheoClaw's own options, against a loopback MCP server that answers `tools/list` only
 * with a bearer, and a loopback provider stub. The bearer is a stored OAuth token (`setTokens`), so
 * no browser flow runs.
 */
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Agent } from '@theokit/sdk'
import { setTokens } from '@theokit/sdk/mcp-auth'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { theoClawAgentOptions } from '../src/agent/create-agent.js'

const TOKEN = 'access-token-for-the-test'
const cleanups: (() => Promise<void>)[] = []
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env.THEOKIT_HOME
  process.env.THEOKIT_HOME = mkdtempSync(join(tmpdir(), 'theoclaw-mcp-tokens-'))
})
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
  if (previousHome === undefined) delete process.env.THEOKIT_HOME
  else process.env.THEOKIT_HOME = previousHome
})

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const server = createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

/** An MCP server on loopback that answers 401 to a request without the bearer; records the `tools/list` ones. */
async function startMcp(): Promise<{ url: string; listAuthorizations: string[] }> {
  const listAuthorizations: string[] = []
  const url = await listen((request, response) => {
    let body = ''
    request.on('data', (chunk: Buffer) => (body += chunk.toString()))
    request.on('end', () => {
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        response.writeHead(401).end()
        return
      }
      const message = JSON.parse(body === '' ? '{}' : body) as { id?: number; method?: string }
      if (message.method === 'tools/list') listAuthorizations.push(request.headers.authorization)
      const results: Record<string, unknown> = {
        initialize: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '0' } },
        'tools/list': { tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object', properties: {} } }] },
      }
      if (message.id === undefined) {
        response.writeHead(202).end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: results[message.method ?? ''] ?? {} }))
    })
  })
  return { url, listAuthorizations }
}

async function startProvider(): Promise<string> {
  const base = await listen((request, response) => {
    request.resume()
    request.on('end', () => {
      const chunk = (delta: Record<string, unknown>, finish: string | null): string =>
        `data: ${JSON.stringify({ id: 's', object: 'chat.completion.chunk', created: 0, model: 's', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(chunk({ role: 'assistant', content: 'ok' }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n')
    })
  })
  return `${base}/v1`
}

/** One turn with `docs` as the MCP server; returns the `mcp_server_ready` and `mcp_server_failed` events. */
async function turn(server: Record<string, unknown>): Promise<{ ready: string[][]; failed: string[] }> {
  const options = theoClawAgentOptions({ model: { id: 'openrouter/stub', url: await startProvider() }, apiKey: 'sk-or-stub-0123456789' })
  const agent = await Agent.create({
    ...options,
    mcpServers: { docs: server as never },
    local: { ...options.local, cwd: mkdtempSync(join(tmpdir(), 'theoclaw-mcp-auth-')) },
  })
  cleanups.push(() => agent[Symbol.asyncDispose]())
  const ready: string[][] = []
  const failed: string[] = []
  const run = await agent.send('hello', {
    onRunEvent: (event) => {
      if (event.type === 'mcp_server_ready') ready.push([...event.tools])
      if (event.type === 'mcp_server_failed') failed.push(event.message)
    },
  })
  for await (const frame of run.stream()) void frame
  await run.wait()
  return { ready, failed }
}

describe('an HTTP MCP server configured through auth.oauth', () => {
  it('lists its tools with the stored OAuth bearer', async () => {
    const mcp = await startMcp()
    const now = Date.now()
    await setTokens('docs', { accessToken: TOKEN, expiresAt: now + 3_600_000, obtainedAt: now })
    const outcome = await turn({
      url: mcp.url,
      auth: { CLIENT_ID: 'client', oauth: { authorizationEndpoint: 'http://127.0.0.1:1/a', tokenEndpoint: 'http://127.0.0.1:1/t', redirectMode: 'manual' } },
    })
    expect(outcome.failed).toEqual([])
    expect(outcome.ready).toEqual([['ping']])
    expect(mcp.listAuthorizations).toEqual([`Bearer ${TOKEN}`])
  }, 30_000)

  it('is refused by the SDK at create when auth has no oauth block', async () => {
    const mcp = await startMcp()
    await expect(turn({ url: mcp.url, auth: { CLIENT_ID: 'client', CLIENT_SECRET: 'a-secret-value' } })).rejects.toThrow(/without auth\.oauth/)
    expect(mcp.listAuthorizations).toEqual([])
  }, 30_000)
})
