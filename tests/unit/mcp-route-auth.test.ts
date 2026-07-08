/**
 * M34 — the MCP route auth gate (closes #97) + default-DENY per-surface exposure.
 *
 * `POST /api/agents/<name>/mcp` (serve-aux-routes) shipped with ZERO CSRF/auth while the sibling
 * agent-run route (mount-agent) enforces CSRF strict — an unauthenticated JSON-RPC surface that can
 * drive the agent (spends LLM tokens). This test asserts the parity fix: cross-origin POST → 403.
 */
import { describe, expect, it } from 'vitest'

import { defineAgent } from '../../packages/agents/src/bridge/define-agent.js'
import { serveAgentAuxRoute } from '../../packages/theo/src/server/agent/serve-aux-routes.js'

const agentMod = {
  default: defineAgent({
    model: 'claude-sonnet-4-6',
    tools: [
      {
        name: 'search',
        description: 'Search',
        inputSchema: { type: 'object', properties: {} },
        handler: () => 'ok',
      },
    ],
  }),
}

// Opts into MCP (default-DENY requires the explicit `mcp: true` export) so the auth tests reach the
// CSRF gate rather than the default-DENY fall-through.
const exposedAgentMod = { ...agentMod, mcp: true }

const deps = {
  agents: [{ name: 'ops', filePath: '/x/ops.ts', agentPath: 'ops' }],
  loadModule: async () => exposedAgentMod,
  baseUrl: 'http://localhost:3000',
  csrfMode: 'strict' as const,
}

function mcpRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost:3000/api/agents/ops/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  })
}

describe('MCP surface default-DENY (M34 — explicit opt-in)', () => {
  const exposedMod = { ...agentMod, mcp: true }
  const optInDeps = {
    ...deps,
    csrfMode: 'off' as const,
    loadModule: async () => exposedMod,
  }
  const denyDeps = {
    ...deps,
    csrfMode: 'off' as const,
    loadModule: async () => agentMod, // NO `mcp: true` export → default-DENY
  }

  it('an agent that does NOT opt into MCP (no `export const mcp = true`) is not exposed → 404 fall-through', async () => {
    const res = await serveAgentAuxRoute(mcpRequest(), '/api/agents/ops/mcp', denyDeps)
    // Default-DENY: the dispatcher returns null so the caller emits a 404 — the agent is NOT an MCP surface.
    expect(res).toBeNull()
  })

  it('an agent that opts in (`export const mcp = true`) IS exposed', async () => {
    const res = await serveAgentAuxRoute(mcpRequest(), '/api/agents/ops/mcp', optInDeps)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
  })
})

describe('MCP route auth gate (M34 — closes #97)', () => {
  it('rejects a cross-origin POST with no CSRF header → 403 (parity with the agent-run route)', async () => {
    const res = await serveAgentAuxRoute(mcpRequest(), '/api/agents/ops/mcp', deps)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('allows a same-origin request carrying the X-Theo-Action header', async () => {
    const res = await serveAgentAuxRoute(
      mcpRequest({ 'X-Theo-Action': '1', origin: 'http://localhost:3000' }),
      '/api/agents/ops/mcp',
      deps,
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
  })

  it('csrfMode "off" skips the gate (dev/testing escape hatch)', async () => {
    const res = await serveAgentAuxRoute(mcpRequest(), '/api/agents/ops/mcp', {
      ...deps,
      csrfMode: 'off',
    })
    expect(res!.status).toBe(200)
  })
})
