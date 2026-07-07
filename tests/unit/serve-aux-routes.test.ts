import { describe, expect, it } from 'vitest'

import { serveAgentAuxRoute } from '../../packages/theo/src/server/agent/serve-aux-routes.js'
import { defineAgent } from '../../packages/agents/src/index.js'
import type { AgentNode } from '../../packages/theo/src/server/scan/agent-scan.js'

/**
 * M15/M16 follow-up — the shared aux-route dispatcher used by BOTH dev + prod. Before this, agent
 * cards / MCP / pending-approvals listing were served ONLY in dev, so a built app 404'd them.
 */

const AGENTS: AgentNode[] = [
  {
    name: 'support',
    filePath: '/agents/support.ts',
    agentPath: '/api/agents/support',
  } as AgentNode,
]

const deps = {
  agents: AGENTS,
  loadModule: async () => ({ default: defineAgent({ model: 'claude-sonnet-4-6', tools: [] }) }),
  baseUrl: 'https://app.example',
}

function req(url: string, method = 'GET', body?: unknown): Request {
  return new Request(`https://app.example${url}`, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  })
}

describe('serveAgentAuxRoute — production parity for card/mcp/list-approvals', () => {
  it('M15 — serves the agent card at /.well-known/<name>/agent-card.json', async () => {
    const path = '/.well-known/support/agent-card.json'
    const res = await serveAgentAuxRoute(req(path), path, deps)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(200)
    const card = (await res!.json()) as { name: string; url: string }
    expect(card.name).toBe('support')
    expect(card.url).toContain('https://app.example')
  })

  it('M16 — serves the MCP JSON-RPC endpoint at /api/agents/<name>/mcp', async () => {
    const path = '/api/agents/support/mcp'
    const res = await serveAgentAuxRoute(
      req(path, 'POST', { jsonrpc: '2.0', id: 1, method: 'initialize' }),
      path,
      deps,
    )
    expect(res).not.toBeNull()
    const rpc = (await res!.json()) as { result?: { serverInfo?: { name?: string } } }
    expect(rpc.result?.serverInfo?.name).toBe('support')
  })

  it('M14 — serves the pending-approvals listing at /api/agents/<name>/approvals', async () => {
    const path = '/api/agents/support/approvals'
    const res = await serveAgentAuxRoute(req(path), path, deps)
    expect(res).not.toBeNull()
    const body = (await res!.json()) as { approvals: unknown[] }
    expect(Array.isArray(body.approvals)).toBe(true)
  })

  it('falls through (null) for a non-aux path', async () => {
    const path = '/api/agents/support'
    expect(await serveAgentAuxRoute(req(path, 'POST'), path, deps)).toBeNull()
  })

  it('falls through (null) for an unknown agent', async () => {
    const path = '/api/agents/ghost/mcp'
    expect(
      await serveAgentAuxRoute(
        req(path, 'POST', { jsonrpc: '2.0', id: 1, method: 'initialize' }),
        path,
        deps,
      ),
    ).toBeNull()
  })

  it('falls through (null) on the wrong method (card is GET-only)', async () => {
    const path = '/.well-known/support/agent-card.json'
    expect(await serveAgentAuxRoute(req(path, 'POST'), path, deps)).toBeNull()
  })
})
