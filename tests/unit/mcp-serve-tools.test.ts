import type { CustomTool } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import {
  handleMcpToolsJsonRpc,
  serveMcpToolsStdio,
} from '../../packages/theo/src/server/agent/index.js'

const schema = (k: string): Record<string, unknown> => ({
  type: 'object',
  properties: { [k]: { type: 'string' } },
  required: [k],
})

const tools: CustomTool[] = [
  {
    name: 'echo',
    description: 'Echo text',
    inputSchema: schema('text'),
    handler: (a: unknown) => (a as { text: string }).text,
  },
  {
    name: 'boom',
    description: 'Always throws',
    inputSchema: schema('x'),
    handler: () => {
      throw new Error('kaboom')
    },
  },
] as unknown as CustomTool[]

async function rpc(method: string, params?: unknown): Promise<any> {
  const res = await handleMcpToolsJsonRpc(tools, 'srv', { jsonrpc: '2.0', id: 1, method, params })
  return res.json()
}

describe('handleMcpToolsJsonRpc', () => {
  it('initialize advertises tools only', async () => {
    const r = await rpc('initialize')
    expect(r.result.capabilities).toEqual({ tools: {} })
    expect(r.result.serverInfo.name).toBe('srv')
  })
  it('tools/list returns names, descriptions and real schemas', async () => {
    const r = await rpc('tools/list')
    expect(r.result.tools).toEqual([
      { name: 'echo', description: 'Echo text', inputSchema: schema('text') },
      { name: 'boom', description: 'Always throws', inputSchema: schema('x') },
    ])
  })
  it('tools/call returns handler result as text', async () => {
    const r = await rpc('tools/call', { name: 'echo', arguments: { text: 'hi' } })
    expect(r.result).toEqual({ content: [{ type: 'text', text: 'hi' }] })
  })
  it('unknown tool, missing name and throwing handler give isError', async () => {
    const u = await rpc('tools/call', { name: 'nope' })
    expect(u.result.isError).toBe(true)
    expect(u.result.content[0].text).toContain('nope')
    expect((await rpc('tools/call', {})).result.isError).toBe(true)
    const b = await rpc('tools/call', { name: 'boom' })
    expect(b.result.isError).toBe(true)
    expect(b.result.content[0].text).toBe('kaboom')
  })
  it('refuses a duplicate name, naming it', () => {
    expect(() => handleMcpToolsJsonRpc([tools[0], tools[0]], 'srv', {})).toThrow(/echo/)
  })
})

describe('serveMcpToolsStdio', () => {
  it('answers scripted lines', async () => {
    const out: string[] = []
    async function* lines(): AsyncIterable<string> {
      yield JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
      yield ''
      yield JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'yo' } },
      })
      yield JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'boom' },
      })
      yield JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'nope' },
      })
    }
    await serveMcpToolsStdio(tools, 'srv', { lines: lines(), write: (l) => out.push(l) })
    const r = out.map((l) => JSON.parse(l))
    expect(r).toHaveLength(4)
    expect(r[0].result.tools.map((t: { name: string }) => t.name)).toEqual(['echo', 'boom'])
    expect(r[1].result.content[0].text).toBe('yo')
    expect(r[2].result.isError).toBe(true)
    expect(r[3].result.isError).toBe(true)
  })
  it('rejects duplicate names', async () => {
    async function* lines(): AsyncIterable<string> {}
    await expect(
      serveMcpToolsStdio([tools[0], tools[0]], 's', { lines: lines(), write: () => {} }),
    ).rejects.toThrow(/echo/)
  })
})
