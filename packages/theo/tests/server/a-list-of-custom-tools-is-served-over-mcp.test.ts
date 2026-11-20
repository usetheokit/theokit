import type { CustomTool, Plugin } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { handleMcpJsonRpc } from '../../src/server/agent/mcp-handler.js'
import { handleMcpStdioLine } from '../../src/server/agent/mcp-stdio.js'
import {
  handleMcpToolsJsonRpc,
  type McpToolsOptions,
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

  describe('with plugins', () => {
    const call = async (options?: McpToolsOptions, list: CustomTool[] = tools): Promise<any> =>
      (
        await handleMcpToolsJsonRpc(
          list,
          'host',
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'echo', arguments: { text: 'x' } },
          },
          options,
        )
      ).json()
    const plugin = (handler: (ctx: any) => unknown): Plugin =>
      ({
        name: 'p',
        version: '1',
        kind: 'general',
        register: (ctx: any) => {
          ctx.on('pre_tool_call', handler)
        },
      }) as unknown as Plugin
    const spied = (): { list: CustomTool[]; ran: () => boolean } => {
      let ran = false
      return {
        list: [{ ...tools[0], handler: () => ((ran = true), 'ok') }] as unknown as CustomTool[],
        ran: () => ran,
      }
    }

    it('a blocking plugin answers tools/call with isError true and its message, and the handler does not run', async () => {
      const s = spied()
      const res = await call(
        { plugins: [plugin(() => ({ block: true, message: 'no way' }))] },
        s.list,
      )
      expect(res.result.isError).toBe(true)
      expect(res.result.content[0].text).toContain('no way')
      expect(s.ran()).toBe(false)
    })

    it('a plugin that throws refuses the call (fail closed)', async () => {
      const s = spied()
      const res = await call(
        {
          plugins: [
            plugin(() => {
              throw new Error('boom')
            }),
          ],
        },
        s.list,
      )
      expect(res.result.isError).toBe(true)
      expect(s.ran()).toBe(false)
    })

    it('tools/list is not filtered by plugins', async () => {
      const res = await (
        await handleMcpToolsJsonRpc(
          tools,
          'host',
          { jsonrpc: '2.0', id: 1, method: 'tools/list' },
          { plugins: [plugin(() => ({ block: true, message: 'no' }))] },
        )
      ).json()
      expect(res.result.tools).toHaveLength(1)
    })

    it('an allowing plugin sees the call context and the tool runs', async () => {
      const seen: any[] = []
      const res = await call({
        plugins: [
          plugin((c) => {
            seen.push(c)
          }),
        ],
        hookContext: { agentId: 'a1' },
      })
      expect(res.result).toEqual({ content: [{ type: 'text', text: 'x' }] })
      expect(seen[0]).toMatchObject({ name: 'echo', args: { text: 'x' }, agentId: 'a1' })
      expect(typeof seen[0].runId).toBe('string')
    })

    it('handleMcpJsonRpc and handleMcpStdioLine forward the options', async () => {
      const s = spied()
      const mod = { tools: s.list, agents: {} }
      const req = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text: 'x' } },
      }
      const options = { plugins: [plugin(() => ({ block: true, message: 'no way' }))] }
      const http: any = await (await handleMcpJsonRpc(mod, 'host', req, [], options)).json()
      expect(http.result.isError).toBe(true)
      const line = await handleMcpStdioLine(JSON.stringify(req), mod, 'host', [], options)
      expect(JSON.parse(line!).result.isError).toBe(true)
      expect(s.ran()).toBe(false)
    })

    it('without options behaviour is unchanged', async () => {
      expect((await call()).result).toEqual({ content: [{ type: 'text', text: 'x' }] })
    })
  })
})
