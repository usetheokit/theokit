import { describe, expect, it } from 'vitest'

import {
  handleMcpStdioLine,
  serveMcpStdio,
} from '../../packages/theo/src/server/agent/mcp-stdio.js'
import { defineAppResource } from '../../packages/theo/src/server/agent/mcp-app-resources.js'
import { defineAgent } from '../../packages/agents/src/index.js'

/**
 * MCP stdio transport — expose an agent as a stdio MCP server, reusing the framework's
 * handleMcpJsonRpc (the sibling of the M16 HTTP route).
 */

const mod = { default: defineAgent({ model: 'claude-sonnet-4-6', tools: [] }) }

describe('handleMcpStdioLine', () => {
  it('answers initialize with serverInfo', async () => {
    const out = await handleMcpStdioLine(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      mod,
      'support',
    )
    const rpc = JSON.parse(out!) as { result: { serverInfo: { name: string } } }
    expect(rpc.result.serverInfo.name).toBe('support')
  })

  it('answers tools/list', async () => {
    const out = await handleMcpStdioLine(
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      mod,
      'support',
    )
    expect(JSON.parse(out!)).toHaveProperty('result.tools')
  })

  it('serves declared appResources over stdio (resources/list)', async () => {
    const resources = [defineAppResource({ uri: 'ui://card', name: 'Card', html: '<b>hi</b>' })]
    const out = await handleMcpStdioLine(
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'resources/list' }),
      mod,
      'support',
      resources,
    )
    const rpc = JSON.parse(out!) as { result: { resources: { uri: string }[] } }
    expect(rpc.result.resources[0].uri).toBe('ui://card')
  })

  it('returns a -32700 Parse error envelope for a malformed line (never throws)', async () => {
    const out = await handleMcpStdioLine('{ not json', mod, 'support')
    expect(JSON.parse(out!)).toMatchObject({ error: { code: -32700 } })
  })

  it('returns null for a blank line', async () => {
    expect(await handleMcpStdioLine('   ', mod, 'support')).toBeNull()
  })
})

describe('serveMcpStdio loop', () => {
  it('reads lines and writes one response line per request', async () => {
    async function* input(): AsyncIterable<string> {
      yield JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })
      yield '' // blank — no output
      yield JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    }
    const written: string[] = []
    await serveMcpStdio(mod, 'support', [], { lines: input(), write: (l) => written.push(l) })

    // Two responses (blank line skipped), each newline-terminated.
    expect(written).toHaveLength(2)
    expect(written.every((l) => l.endsWith('\n'))).toBe(true)
    expect(JSON.parse(written[0]!)).toHaveProperty('result.serverInfo')
    expect(JSON.parse(written[1]!)).toHaveProperty('result.tools')
  })
})
