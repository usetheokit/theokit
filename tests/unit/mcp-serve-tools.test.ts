import type { CustomTool } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import {
  handleMcpToolsJsonRpc,
  serveMcpToolsStdio,
} from '../../packages/theo/src/server/agent/index.js'

const schema = { type: 'object', properties: { a: { type: 'number' } }, required: ['a'] }
const tools = [
  {
    name: 'echo',
    description: 'Echo text',
    inputSchema: schema,
    handler: async (i: unknown) => `hi ${JSON.stringify(i)}`,
  },
  {
    name: 'obj',
    description: 'Return an object',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({ ok: true }),
  },
  {
    name: 'boom',
    description: 'Throws',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      throw new Error('kaput')
    },
  },
] as unknown as CustomTool[]

async function rpc(method: string, params?: unknown): Promise<any> {
  const res = await handleMcpToolsJsonRpc(tools, 'svc', { jsonrpc: '2.0', id: 1, method, params })
  return res.json()
}

describe('handleMcpToolsJsonRpc', () => {
  it('initialize advertises tools only', async () => {
    const r = await rpc('initialize')
    expect(r.result.capabilities).toEqual({ tools: {} })
    expect(r.result.serverInfo.name).toBe('svc')
  })

  it('tools/list returns names, descriptions and real schemas', async () => {
    const r = await rpc('tools/list')
    expect(r.result.tools[0]).toEqual({
      name: 'echo',
      description: 'Echo text',
      inputSchema: schema,
    })
    expect(r.result.tools.map((t: { name: string }) => t.name)).toEqual(['echo', 'obj', 'boom'])
  })

  it('tools/call returns handler result as text', async () => {
    const r = await rpc('tools/call', { name: 'echo', arguments: { a: 1 } })
    expect(r.result).toEqual({ content: [{ type: 'text', text: 'hi {"a":1}' }] })
    const o = await rpc('tools/call', { name: 'obj' })
    expect(o.result.content[0].text).toBe('{"ok":true}')
  })

  it('unknown tool, missing name and throwing handler give isError', async () => {
    expect((await rpc('tools/call', { name: 'nope' })).result.isError).toBe(true)
    expect((await rpc('tools/call', {})).result.isError).toBe(true)
    const r = await rpc('tools/call', { name: 'boom' })
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toBe('kaput')
  })

  it('refuses a duplicate name, naming it', () => {
    const dup = [tools[0]!, tools[0]!]
    expect(() => handleMcpToolsJsonRpc(dup, 'svc', {})).toThrow(/echo/)
  })
})

describe('serveMcpToolsStdio', () => {
  it('serves the same calls over scripted stdio', async () => {
    const input = [
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'echo', arguments: { a: 2 } },
      },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'boom' } },
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } },
    ].map((m) => JSON.stringify(m))
    async function* lines(): AsyncIterable<string> {
      yield* input
    }
    const out: string[] = []
    await serveMcpToolsStdio(tools, 'svc', { lines: lines(), write: (l) => out.push(l) })
    const rs = out.map((l) => JSON.parse(l))
    expect(rs).toHaveLength(4)
    expect(rs[0].result.tools).toHaveLength(3)
    expect(rs[1].result.content[0].text).toBe('hi {"a":2}')
    expect(rs[2].result.isError).toBe(true)
    expect(rs[3].result.isError).toBe(true)
  })

  it('rejects a duplicate name', async () => {
    async function* lines(): AsyncIterable<string> {}
    await expect(
      serveMcpToolsStdio([tools[0]!, tools[0]!], 'svc', { lines: lines(), write: () => {} }),
    ).rejects.toThrow(/echo/)
  })
})
