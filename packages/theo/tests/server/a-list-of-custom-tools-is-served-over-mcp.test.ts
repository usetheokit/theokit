import type { CustomTool, Plugin } from '@theokit/sdk'
import { describe, expect, it } from 'vitest'

import { handleMcpJsonRpc } from '../../src/server/agent/mcp-handler.js'
import {
  handleMcpStdioLine,
  handleMcpToolsHttp,
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
      expect(res.result).toEqual({ content: [{ type: 'text', text: 'x' }], isError: false })
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

    const callReq = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'echo', arguments: { text: 'x' } },
    }

    it('handleMcpToolsHttp applies a blocking plugin', async () => {
      const s = spied()
      const req = new Request('http://x/mcp', {
        method: 'POST',
        body: JSON.stringify(callReq),
        headers: { 'content-type': 'application/json' },
      })
      const res: any = await (
        await handleMcpToolsHttp(s.list, 'host', req, {
          plugins: [plugin(() => ({ block: true, message: 'no way' }))],
        })
      ).json()
      expect(res.result.isError).toBe(true)
      expect(res.result.content[0].text).toContain('no way')
      expect(s.ran()).toBe(false)
    })

    it('serveMcpToolsStdio applies a blocking plugin', async () => {
      const s = spied()
      const out: string[] = []
      async function* lines(): AsyncGenerator<string> {
        yield JSON.stringify(callReq)
      }
      await serveMcpToolsStdio(
        s.list,
        'host',
        { lines: lines(), write: (l) => out.push(l) },
        { plugins: [plugin(() => ({ block: true, message: 'no way' }))] },
      )
      const res = JSON.parse(out[0]!)
      expect(res.result.isError).toBe(true)
      expect(res.result.content[0].text).toContain('no way')
      expect(s.ran()).toBe(false)
    })

    it('without options behaviour is unchanged', async () => {
      expect((await call()).result).toEqual({
        content: [{ type: 'text', text: 'x' }],
        isError: false,
      })
    })
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
    const custom = { protocolVersions: ['2030-01-01', '2029-01-01'] }
    expect(await v('2029-01-01', custom)).toBe('2029-01-01')
    expect(await v('2025-06-18', custom)).toBe('2030-01-01')
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

  it('forwards options so a blocking plugin answers tools/call with isError true', async () => {
    let ran = false
    const toolList = [
      {
        name: 'echo',
        description: 'Echo text',
        inputSchema: { type: 'object' },
        handler: () => {
          ran = true
          return 'ok'
        },
      },
    ] as unknown as CustomTool[]
    const blockingPlugin = {
      name: 'guard',
      version: '1',
      kind: 'general',
      register: (ctx: any) => {
        ctx.on('pre_tool_call', () => ({ block: true, message: 'no way http' }))
      },
    } as unknown as Plugin
    const res = await handleMcpToolsHttp(
      toolList,
      'host',
      post(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'echo', arguments: {} },
        }),
      ),
      { plugins: [blockingPlugin] },
    )
    const json: any = await res.json()
    expect(json.result.isError).toBe(true)
    expect(json.result.content[0].text).toContain('no way http')
    expect(ran).toBe(false)
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
