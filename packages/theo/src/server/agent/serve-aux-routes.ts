/**
 * M15/M16 follow-up — shared dispatcher for the agent AUXILIARY routes that BOTH dev (vite
 * middleware) and prod (`theokit start` handler) must serve identically. Before this, these routes
 * were wired only into the dev middleware, so a built/deployed app served none of them (agent cards,
 * MCP, pending-approvals listing all 404'd in production).
 *
 * Single source of truth (DRY): one Web-Request→Response dispatcher, two callers. It handles the
 * routes that derive purely from the agent module + shared registry:
 *  - **M15** `GET /.well-known/<name>/agent-card.json` → {@link handleAgentCard}
 *  - **M14** `GET /api/agents/<name>/approvals`        → {@link handleListApprovals}
 *  - **M16** `POST /api/agents/<name>/mcp`             → {@link handleMcpJsonRpc}
 *
 * Channels (M27) are NOT here: a channel webhook needs app-supplied `validators` + `onMessage`, so
 * the app wires `handleChannelWebhook` in its own route (it cannot be auto-derived from the module).
 * The HITL approve route stays in each caller (it carries caller-specific rate-limiting/CSRF plumbing).
 */
import type { AgentNode } from '../scan/agent-scan.js'

import { isAgentCardPath, handleAgentCard } from './agent-card-handler.js'
import { getApprovalRegistry } from './approval-registry.js'
import { isListApprovalsPath, handleListApprovals } from './list-approvals-handler.js'
import { extractAppResources } from './mcp-app-resources.js'
import { isMcpPath, handleMcpJsonRpc } from './mcp-handler.js'

/** Dependencies the aux dispatcher needs from its caller (dev or prod). */
export interface AuxRouteDeps {
  /** Discovered agents (from `scanAgents`). */
  agents: readonly AgentNode[]
  /** Load an agent module from its file path (dev: vite loader; prod: dynamic import). */
  loadModule: (filePath: string) => Promise<unknown>
  /** Absolute base URL (`http(s)://host`) for the agent-card endpoint URLs. */
  baseUrl: string
}

/**
 * Serve an agent auxiliary route. Returns a `Response` when `urlPath` matches an aux route (card /
 * list-approvals / mcp) and the method + agent resolve; returns `null` to fall through (not an aux
 * route, wrong method, or unknown agent — the caller then owns the 404/next).
 */
export async function serveAgentAuxRoute(
  request: Request,
  urlPath: string,
  deps: AuxRouteDeps,
): Promise<Response | null> {
  const method = request.method.toUpperCase()

  // M15 — A2A agent card at `/.well-known/<name>/agent-card.json` (GET).
  const cardName = isAgentCardPath(urlPath)
  if (cardName !== null) {
    if (method !== 'GET') return null
    const agent = deps.agents.find((a) => a.name === cardName)
    if (!agent) return null
    const mod = await deps.loadModule(agent.filePath)
    return handleAgentCard(mod, agent.name, agent.agentPath, deps.baseUrl)
  }

  // M14 — GET /api/agents/<name>/approvals (pending HITL approvals).
  if (isListApprovalsPath(urlPath)) {
    if (method !== 'GET') return null
    return handleListApprovals(getApprovalRegistry())
  }

  // M16 — POST /api/agents/<name>/mcp (JSON-RPC MCP server).
  const mcpName = isMcpPath(urlPath)
  if (mcpName !== null) {
    if (method !== 'POST') return null
    const agent = deps.agents.find((a) => a.name === mcpName)
    if (!agent) return null
    let body: unknown = null
    try {
      body = await request.json()
    } catch {
      /* malformed/empty JSON → handleMcpJsonRpc returns a -32600 envelope */
    }
    const mod = await deps.loadModule(agent.filePath)
    // M30 — pass the agent's declared `ui://` App resources (named `appResources` export) so the
    // MCP server advertises + serves them via resources/list + resources/read.
    return handleMcpJsonRpc(mod, agent.name, body, extractAppResources(mod))
  }

  return null
}
