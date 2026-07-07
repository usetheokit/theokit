/**
 * M16 (theokit-ai-first) — serve an agent as an MCP server over HTTP (JSON-RPC).
 *
 * `buildMcpToolDescriptors` / `mcpServerInfo` (@theokit/agents) are the pure generators; this
 * handler answers the two core MCP methods over JSON-RPC: `initialize` and `tools/list`. Unknown
 * methods return a JSON-RPC method-not-found error. Web Standards Response (G8). The stdio transport
 * stays SDK-side (sdk-runtime.md).
 *
 * TDD RED-first.
 */
import { describe, expect, it } from 'vitest'

import { defineAgent } from '../../packages/agents/src/index.js'

import { handleMcpJsonRpc, isMcpPath } from '../../packages/theo/src/server/agent/mcp-handler.js'

const mod = {
  default: defineAgent({
    model: 'claude-sonnet-4-6',
    tools: [
      {
        name: 'search',
        description: 'Search the KB',
        inputSchema: { type: 'object', properties: {} },
        handler: () => 'ok',
      },
    ],
  }),
}

async function rpc(mod: unknown, name: string, body: unknown) {
  const res = handleMcpJsonRpc(mod, name, body)
  return { status: res.status, json: (await res.json()) as Record<string, unknown> }
}

describe('isMcpPath', () => {
  it('matches /api/agents/<name>/mcp', () => {
    expect(isMcpPath('/api/agents/ops/mcp')).toBe('ops')
  })
  it('rejects other paths', () => {
    expect(isMcpPath('/api/agents/ops')).toBeNull()
  })
})

describe('handleMcpJsonRpc', () => {
  it('answers initialize with protocolVersion + serverInfo + tools capability', async () => {
    const { status, json } = await rpc(mod, 'ops', { jsonrpc: '2.0', id: 1, method: 'initialize' })
    expect(status).toBe(200)
    expect(json.id).toBe(1)
    const result = json.result as { protocolVersion: string; serverInfo: { name: string }; capabilities: { tools: unknown } }
    expect(result.serverInfo.name).toBe('ops')
    expect(typeof result.protocolVersion).toBe('string')
    expect(result.capabilities.tools).toBeDefined()
  })

  it('answers tools/list with the agent tool descriptors', async () => {
    const { json } = await rpc(mod, 'ops', { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const result = json.result as { tools: { name: string }[] }
    expect(result.tools.map((t) => t.name)).toEqual(['search'])
  })

  it('returns JSON-RPC method-not-found (-32601) for an unknown method', async () => {
    const { json } = await rpc(mod, 'ops', { jsonrpc: '2.0', id: 3, method: 'nope' })
    const error = json.error as { code: number }
    expect(error.code).toBe(-32601)
  })

  it('returns a parse/invalid error for a non-JSON-RPC body', async () => {
    const { json } = await rpc(mod, 'ops', { not: 'jsonrpc' })
    expect(json.error).toBeDefined()
  })
})
