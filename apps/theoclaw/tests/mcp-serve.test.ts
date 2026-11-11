import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'

import { afterEach, describe, expect, it } from 'vitest'

import { runCli } from '../src/cli.js'
import { handleMcpRequest } from '../src/mcp/serve-tools.js'
import { buildTools } from '../src/tools/tool-registry.js'
import { resolveToolSettings } from '../src/tools/tool-settings.js'
import { cleanScratch, harness } from './support/cli-harness.js'

afterEach(cleanScratch)

const call = (id: number, name: string, args: unknown) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })

describe('theoclaw mcp', () => {
  it('serves list_dir over stdio until stdin ends', async () => {
    const h = harness()
    const files = join(h.io.cwd, 'files')
    mkdirSync(files, { recursive: true })
    writeFileSync(join(files, 'hello.txt'), 'hi')
    const stdin = h.io.stdin as PassThrough
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`)
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
    stdin.write(`${call(3, 'list_dir', { path: '.' })}\n`)
    stdin.end()

    expect(await runCli(['mcp'], h.io)).toBe(0)

    const replies = h
      .stdout()
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(replies[0].result.serverInfo.name).toBe('theoclaw')
    expect(replies[1].result.tools.map((t: { name: string }) => t.name)).toContain('list_dir')
    expect(JSON.stringify(replies[2])).toContain('hello.txt')
  })

  it('refuses arguments', async () => {
    const h = harness()
    expect(await runCli(['mcp', 'x'], h.io)).toBe(2)
  })

  it('/mcp route answers a POST and refuses other methods', async () => {
    const h = harness()
    const settings = resolveToolSettings({}, h.io.cwd)
    const tools = buildTools(settings)
    const post = await handleMcpRequest(tools, settings, new Request('http://x/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }))
    expect(JSON.stringify(await post.json())).toContain('list_dir')
    expect((await handleMcpRequest(tools, settings, new Request('http://x/mcp'))).status).toBe(405)
  })
})
