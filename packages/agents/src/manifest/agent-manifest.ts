/**
 * Agent manifest generator — build-time JSON describing all agents, tools, guards, policies.
 *
 * Feeds: theokit agents list/inspect, TheoCloud deploy, UI agent consoles.
 */
/**
 * M53 — the manifest's OWN input contract, listing exactly the members it reads. It used to take an
 * `AgentWalkResult`, which chained the manifest to the decorator metadata walk that M53 deletes.
 *
 * `AgentWalkResult` satisfies this structurally, so the decorator path keeps working unchanged while
 * the migration is in flight; once the walk is gone, the capability path builds this directly. The
 * point is that the manifest never needed the whole walk — only these members.
 */
export interface AgentManifestSource {
  readonly agentConfig: { name: string; model?: string; stream?: boolean }
  readonly route: string
  readonly mainLoop: { propertyKey: string | symbol; strategy: string }
  readonly guards: readonly { name: string }[]
  readonly interceptors: readonly { name: string }[]
  readonly toolboxes: readonly {
    namespace?: string
    tools: readonly {
      config: { name: string; description: string; risk?: string }
      approval?: unknown
      capabilities?: string[]
      trace: boolean
      audit: boolean
    }[]
  }[]
  readonly gateway?: { platforms: string[]; sessionStrategy?: string }
  readonly subAgentClasses: readonly { name: string }[]
  readonly memory?: { provider?: string; embeddings?: boolean; fts?: boolean; scope?: string }
  readonly skills?: { include?: string[] }
  readonly mcpServers?: Record<string, unknown>
}

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
 * Generate a serializable agent manifest from an {@link AgentManifestSource} per agent.
 * All Function references are converted to string names for JSON safety.
 */
export function generateAgentManifest(sources: AgentManifestSource[]): AgentManifest {
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    agents: sources.map((r) => ({
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
        ? {
            platforms: r.gateway.platforms,
            sessionStrategy: r.gateway.sessionStrategy ?? 'per-user',
          }
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
