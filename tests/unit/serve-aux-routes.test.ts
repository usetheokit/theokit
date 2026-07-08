import { describe, expect, it } from 'vitest'

import { serveAgentAuxRoute } from '../../packages/theo/src/server/agent/serve-aux-routes.js'
import { defineAgent } from '../../packages/agents/src/bridge/define-agent.js'
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

/**
 * M30 wiring — an agent module that exports `appResources` (from `defineAppResource`) has them
 * advertised + served by the MCP endpoint (resources/list) via the serve-aux dispatcher.
 */
import { defineAppResource } from '../../packages/theo/src/server/agent/mcp-app-resources.js'

describe('serveAgentAuxRoute — M30 per-agent appResources wiring', () => {
  const withResources = {
    agents: [{ name: 'ui', filePath: '/agents/ui.ts', agentPath: '/api/agents/ui' } as AgentNode],
    loadModule: async () => ({
      default: defineAgent({ model: 'claude-sonnet-4-6', tools: [] }),
      appResources: [defineAppResource({ uri: 'ui://card', name: 'Card', html: '<b>hi</b>' })],
    }),
    baseUrl: 'https://app.example',
  }

  it('resources/list returns the module-declared ui:// resources', async () => {
    const path = '/api/agents/ui/mcp'
    const res = await serveAgentAuxRoute(
      req(path, 'POST', { jsonrpc: '2.0', id: 1, method: 'resources/list' }),
      path,
      withResources,
    )
    const rpc = (await res!.json()) as { result?: { resources?: { uri: string }[] } }
    expect(rpc.result?.resources).toEqual([
      { uri: 'ui://card', name: 'Card', mimeType: 'text/html' },
    ])
  })

  it('initialize advertises capabilities.resources when the module declares any', async () => {
    const path = '/api/agents/ui/mcp'
    const res = await serveAgentAuxRoute(
      req(path, 'POST', { jsonrpc: '2.0', id: 1, method: 'initialize' }),
      path,
      withResources,
    )
    const rpc = (await res!.json()) as { result?: { capabilities?: Record<string, unknown> } }
    expect(rpc.result?.capabilities).toHaveProperty('resources')
  })
})
