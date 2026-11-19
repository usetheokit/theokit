import type { CustomTool } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import {
  handleMcpStdioLine,
  handleMcpToolsHttp,
  handleMcpToolsJsonRpc,
  serveMcpToolsStdio,
} from '../../src/server/agent/index.js'

/**
 * A host application with no `defineAgent` module (TheoClaw) serves its own `CustomTool`s over MCP
 * through the `server/agent` entry point: an MCP client lists them with `tools/list` and runs them
 * with `tools/call`.
 */
const tools = [
  {
    name: 'echo',
    description: 'Echo text',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    handler: (a: unknown) => (a as { text: string }).text,
  },
] as unknown as CustomTool[]

describe('a list of CustomTools served over MCP', () => {
  it('is listed by tools/list and called through tools/call over HTTP', async () => {
    const rpc = async (method: string, params?: unknown): Promise<any> =>
      (await handleMcpToolsJsonRpc(tools, 'host', { jsonrpc: '2.0', id: 1, method, params })).json()
    const listed = await rpc('tools/list')
    expect(listed.result.tools).toEqual([
      { name: 'echo', description: 'Echo text', inputSchema: tools[0].inputSchema },
    ])
    const called = await rpc('tools/call', { name: 'echo', arguments: { text: 'hi' } })
    expect(called.result).toEqual({ content: [{ type: 'text', text: 'hi' }], isError: false })
  })

  it('is listed and called over stdio', async () => {
    const out: string[] = []
    async function* lines(): AsyncIterable<string> {
      yield JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      yield JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'yo' } },
      })
    }
    await serveMcpToolsStdio(tools, 'host', { lines: lines(), write: (l) => out.push(l) })
    const r = out.map((l) => JSON.parse(l))
    expect(r[0].result.tools.map((t: { name: string }) => t.name)).toEqual(['echo'])
    expect(r[1].result.content[0].text).toBe('yo')
  })
})

describe('handleMcpToolsHttp', () => {
  const post = (body: string): Request =>
    new Request('http://x/mcp', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    })
  const rpc = (msg: unknown, opts?: Parameters<typeof handleMcpToolsHttp>[3]): Promise<Response> =>
    handleMcpToolsHttp(tools, 'host', post(JSON.stringify(msg)), opts)
  const boom = [
    {
      name: 'boom',
      description: 'b',
      inputSchema: {},
      handler: () => {
        throw new Error('no')
      },
    },
  ] as unknown as CustomTool[]

  it('answers GET with 405 and allow: POST', async () => {
    const res = await handleMcpToolsHttp(tools, 'host', new Request('http://x/mcp'))
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
  })

  it('answers bad JSON with 400 -32700 and a batch with 400 -32600', async () => {
    const bad = await handleMcpToolsHttp(tools, 'host', post('{'))
    expect(bad.status).toBe(400)
    const b: any = await bad.json()
    expect(b.error.code).toBe(-32700)
    expect(b.id).toBeNull()
    const batch = await handleMcpToolsHttp(tools, 'host', post('[]'))
    expect(batch.status).toBe(400)
    expect(((await batch.json()) as any).error.code).toBe(-32600)
  })

  it('answers a notification with 202 and an empty body', async () => {
    const res = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(res.status).toBe(202)
    expect(await res.text()).toBe('')
  })

  it('answers ping with an empty result and echoes string and number ids', async () => {
    expect(await (await rpc({ jsonrpc: '2.0', id: 7, method: 'ping' })).json()).toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: {},
    })
    expect(
      ((await (await rpc({ jsonrpc: '2.0', id: 'a', method: 'ping' })).json()) as any).id,
    ).toBe('a')
  })

  it('negotiates the protocol version', async () => {
    const v = async (
      pv: string,
      opts?: Parameters<typeof handleMcpToolsHttp>[3],
    ): Promise<string> =>
      (
        (await (
          await rpc(
            { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: pv } },
            opts,
          )
        ).json()) as any
      ).result.protocolVersion
    expect(await v('2025-03-26')).toBe('2025-03-26')
    expect(await v('1999-01-01')).toBe('2025-06-18')
    expect(await v('2024-11-05', { protocolVersions: ['2024-11-05'] })).toBe('2024-11-05')
  })

  it('sets isError false on success and true for a throwing tool', async () => {
    const ok: any = await (
      await rpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'a' } },
      })
    ).json()
    expect(ok.result.isError).toBe(false)
    const res = await handleMcpToolsHttp(
      boom,
      'host',
      post(
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'boom' } }),
      ),
    )
    expect(((await res.json()) as any).result.isError).toBe(true)
  })

  it('stdio returns null for a notification line', async () => {
    expect(
      await handleMcpStdioLine(
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        {},
        'host',
      ),
    ).toBeNull()
  })
})
