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

import { defineAgent } from '../../packages/agents/src/bridge/define-agent.js'

import { handleMcpJsonRpc, isMcpPath } from '../../packages/theo/src/server/agent/mcp-handler.js'

const mod = {
  default: defineAgent({
    model: 'claude-sonnet-4-6',
    tools: [
      {
        name: 'search',
        description: 'Search the KB',
        // M34 — a real input schema (not the dropped empty `{properties:{}}`).
        inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] },
        handler: (input: unknown) => `found:${(input as { q?: string }).q}`,
      },
    ],
  }),
}

async function rpc(mod: unknown, name: string, body: unknown) {
  const res = await handleMcpJsonRpc(mod, name, body)
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
    const result = json.result as {
      protocolVersion: string
      serverInfo: { name: string }
      capabilities: { tools: unknown }
    }
    expect(result.serverInfo.name).toBe('ops')
    expect(typeof result.protocolVersion).toBe('string')
    expect(result.capabilities.tools).toBeDefined()
  })

  it('answers tools/list with the agent tool descriptors', async () => {
    const { json } = await rpc(mod, 'ops', { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const result = json.result as { tools: { name: string }[] }
    expect(result.tools.map((t) => t.name)).toEqual(['search'])
  })

  it('M34 — tools/list retains the real Zod-derived inputSchema (not the dropped empty one)', async () => {
    const { json } = await rpc(mod, 'ops', { jsonrpc: '2.0', id: 20, method: 'tools/list' })
    const result = json.result as {
      tools: { name: string; inputSchema: { properties?: Record<string, unknown> } }[]
    }
    const search = result.tools.find((t) => t.name === 'search')!
    // Before M34 this was `{properties:{}}` — the schema was dropped. Now the real props survive.
    expect(search.inputSchema.properties).toHaveProperty('q')
  })

  it('M34 — tools/call EXECUTES the tool and returns a CallToolResult', async () => {
    const { json } = await rpc(mod, 'ops', {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: { name: 'search', arguments: { q: 'theo' } },
    })
    // Proper MCP CallToolResult: content[] with a text item, isError false.
    const result = json.result as { content: { type: string; text: string }[]; isError?: boolean }
    expect(result.isError).toBeFalsy()
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'found:theo' })
  })

  it('M34 — tools/call on an unknown tool returns an error result (not -32601 crash)', async () => {
    const { json } = await rpc(mod, 'ops', {
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: { name: 'nonexistent', arguments: {} },
    })
    // Unknown tool → a JSON-RPC error OR an isError result; either is acceptable, never a silent 200 ok.
    const hasError =
      json.error !== undefined ||
      (json.result as { isError?: boolean } | undefined)?.isError === true
    expect(hasError).toBe(true)
  })

  it('M34 — initialize advertises a current protocol version (not the stale 2024-11-05)', async () => {
    const { json } = await rpc(mod, 'ops', { jsonrpc: '2.0', id: 23, method: 'initialize' })
    const result = json.result as { protocolVersion: string }
    expect(result.protocolVersion).not.toBe('2024-11-05')
    expect(result.protocolVersion >= '2025-06-18').toBe(true)
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
