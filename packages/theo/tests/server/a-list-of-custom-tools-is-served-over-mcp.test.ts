import type { CustomTool } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { handleMcpToolsJsonRpc, serveMcpToolsStdio } from '../../src/server/agent/index.js'

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
    expect(called.result).toEqual({ content: [{ type: 'text', text: 'hi' }] })
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
