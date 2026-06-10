/**
 * Agent manifest generator — build-time JSON describing all agents, tools, guards, policies.
 *
 * Feeds: theokit agents list/inspect, TheoCloud deploy, UI agent consoles.
 */
import type { AgentWalkResult } from '../bridge/walk-agent-metadata.js'

export interface AgentManifest {
  version: '1.0'
  generatedAt: string
  agents: AgentManifestEntry[]
}

export interface AgentManifestEntry {
  name: string
  route: string
  model?: string
  stream: boolean
  mainLoop: {
    method: string
    strategy: string
  }
  guards: string[]
  interceptors: string[]
  tools: AgentManifestTool[]
  gateway?: {
    platforms: string[]
    sessionStrategy: string
  }
  subAgents: string[]
  memory?: { provider: string; embeddings: boolean; fts: boolean; scope: string }
  skills?: string[]
  mcpServers?: string[]
}

export interface AgentManifestTool {
  name: string
  description: string
  risk?: string
  approval: boolean
  capabilities?: string[]
  trace: boolean
  audit: boolean
}

/**
 * Generate a serializable agent manifest from walked metadata.
 * All Function references are converted to string names for JSON safety.
 */
export function generateAgentManifest(walkResults: AgentWalkResult[]): AgentManifest {
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    agents: walkResults.map((r) => ({
      name: r.agentConfig.name,
      route: r.route,
      model: r.agentConfig.model,
      stream: r.agentConfig.stream ?? true,
      mainLoop: {
        method: String(r.mainLoop.propertyKey),
        strategy: r.mainLoop.strategy,
      },
      guards: r.guards.map((g) => g.name),
      interceptors: r.interceptors.map((i) => i.name),
      tools: r.toolboxes.flatMap((tb) =>
        tb.tools.map((t) => ({
          name: tb.namespace ? `${tb.namespace}.${t.config.name}` : t.config.name,
          description: t.config.description,
          risk: t.config.risk,
          approval: t.approval !== undefined,
          capabilities: t.capabilities,
          trace: t.trace,
          audit: t.audit,
        })),
      ),
      gateway: r.gateway
        ? { platforms: r.gateway.platforms, sessionStrategy: r.gateway.sessionStrategy ?? 'per-user' }
        : undefined,
      subAgents: r.subAgentClasses.map((cls) => cls.name),
      memory: r.memory
        ? {
            provider: r.memory.provider ?? 'built-in',
            embeddings: r.memory.embeddings ?? false,
            fts: r.memory.fts ?? false,
            scope: r.memory.scope ?? 'per-user',
          }
        : undefined,
      skills: r.skills?.include,
      mcpServers: r.mcpServers ? Object.keys(r.mcpServers) : undefined,
    })),
  }
}
