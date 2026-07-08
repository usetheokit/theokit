/**
 * Manifest loading stage for `theokit start` (T4.2 architecture-cleanup).
 *
 * Loads pre-built manifest from `.theokit/manifest.json` if present; otherwise
 * scans server/ for routes/actions/ws at startup with a structured warn.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { dirname } from 'node:path'

import { warnOnce } from '../../../server/observability/logger.js'
import type { ActionNode } from '../../../server/scan/action-scan.js'
import { scanServerActions } from '../../../server/scan/action-scan.js'
import type { AgentNode } from '../../../server/scan/agent-scan.js'
import { scanAgents } from '../../../server/scan/agent-scan.js'
import { loadManifest } from '../../../server/scan/manifest.js'
import type { ServerRouteNode } from '../../../server/scan/match.js'
import { scanServerRoutes } from '../../../server/scan/scan.js'
import type { WebSocketRouteNode } from '../../../server/scan/ws-scan.js'
import { scanWebSocketRoutes } from '../../../server/scan/ws-scan.js'

export interface LoadedRoutes {
  routes: ServerRouteNode[]
  actions: ActionNode[]
  wsRoutes: WebSocketRouteNode[]
  agents: AgentNode[]
}

export function loadRoutesAndActions(
  distDir: string,
  serverDir: string,
  // #95 follow-up — agents dir name (config `agentsDir`, default "agents") for the live-scan fallback.
  agentsDir = 'agents',
): LoadedRoutes {
  const manifestPath = join(distDir, 'manifest.json')

  if (existsSync(manifestPath)) {
    const manifest = loadManifest(distDir, serverDir)
    return {
      routes: manifest.routes,
      actions: manifest.actions,
      wsRoutes: manifest.websockets,
      agents: manifest.agents,
    }
  }
  warnOnce('bootstrap.manifest_not_found', {
    event: 'bootstrap.manifest_not_found',
    message:
      'No manifest found, scanning routes at startup. Run "theo build" to generate manifest.',
    serverDir,
  })
  return {
    routes: scanServerRoutes(serverDir),
    actions: scanServerActions(serverDir),
    wsRoutes: scanWebSocketRoutes(serverDir),
    // Agents live at <projectRoot>/<agentsDir>; projectRoot = serverDir's parent for the canonical layout.
    agents: scanAgents(dirname(serverDir), agentsDir),
  }
}
