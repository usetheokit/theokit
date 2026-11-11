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

const call = (id: number, name: string, args: unknown) =>
  JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })

describe('theoclaw mcp', () => {
  it('serves list_dir over stdio until stdin ends', async () => {
    const h = harness()
    const files = join(h.io.cwd, 'files')
    mkdirSync(files, { recursive: true })
    writeFileSync(join(files, 'hello.txt'), 'hi')
    const stdin = h.io.stdin as PassThrough
    stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`,
    )
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
    const post = await handleMcpRequest(
      tools,
      settings,
      new Request('http://x/mcp', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    )
    expect(JSON.stringify(await post.json())).toContain('list_dir')
    expect((await handleMcpRequest(tools, settings, new Request('http://x/mcp'))).status).toBe(405)
  })

  describe('/mcp conformance', () => {
    const rpc = async (body: unknown, method = 'POST') => {
      const h = harness()
      mkdirSync(join(h.io.cwd, 'files'), { recursive: true })
      writeFileSync(join(h.io.cwd, 'files', 'a.txt'), 'x')
      const settings = resolveToolSettings({}, h.io.cwd)
      const init = {
        method,
        ...(method === 'POST'
          ? { body: typeof body === 'string' ? body : JSON.stringify(body) }
          : {}),
      }
      return handleMcpRequest(buildTools(settings), settings, new Request('http://x/mcp', init))
    }

    it('initialize negotiates the version', async () => {
      const r = await (
        await rpc({
          jsonrpc: '2.0',
          id: 'a',
          method: 'initialize',
          params: { protocolVersion: '2025-03-26' },
        })
      ).json()
      expect(r.id).toBe('a')
      expect(r.result.protocolVersion).toBe('2025-03-26')
      expect(r.result.capabilities.tools).toBeDefined()
      expect(r.result.serverInfo.name).toBe('theoclaw')
      const n = await (
        await rpc({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '1999-01-01' },
        })
      ).json()
      expect(n.result.protocolVersion).toBe('2025-06-18')
    })

    it('a notification gets 202 and no body', async () => {
      const r = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
      expect(r.status).toBe(202)
      expect(await r.text()).toBe('')
    })

    it('answers ping', async () => {
      expect(await (await rpc({ jsonrpc: '2.0', id: 7, method: 'ping' })).json()).toEqual({
        jsonrpc: '2.0',
        id: 7,
        result: {},
      })
    })

    it('rejects a batch with a JSON-RPC error', async () => {
      const r = await rpc([{ jsonrpc: '2.0', id: 1, method: 'ping' }])
      expect((await r.json()).error.code).toBe(-32600)
    })

    it('refuses GET and DELETE with allow: POST', async () => {
      for (const m of ['GET', 'DELETE', 'PUT']) {
        const r = await rpc(null, m)
        expect(r.status).toBe(405)
        expect(r.headers.get('allow')).toBe('POST')
      }
    })

    it('unknown method, bad JSON and ids', async () => {
      const u = await (await rpc({ jsonrpc: '2.0', id: 'z', method: 'nope' })).json()
      expect(u.error.code).toBe(-32601)
      expect(u.id).toBe('z')
      expect((await (await rpc('{bad')).json()).error.code).toBe(-32700)
    })

    it('tools/call list_dir succeeds and a failure is isError', async () => {
      const ok = await (
        await rpc({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'list_dir', arguments: { path: '.' } },
        })
      ).json()
      expect(ok.result.isError).toBe(false)
      expect(ok.result.content[0].type).toBe('text')
      expect(ok.result.content[0].text).toContain('a.txt')
      const bad = await (
        await rpc({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'no_such_tool', arguments: {} },
        })
      ).json()
      expect(bad.result.isError).toBe(true)
    })
  })
})
