/**
 * M24 (ADR-0041) — MCP follow-ups, framework-side layer over the `@MCP` config (ADR-0040 § D2).
 *
 * Three home/boundary helpers that compose with the existing `@MCP` / `defineAgent` surfaces — the
 * SDK still owns MCP server EXECUTION (`Agent.create({ mcpServers })`); these only shape the config:
 *  - `resolveMcpServers` — per-request resolver so multi-tenant apps hand different MCP creds to
 *    different callers (mirrors the M13 skills resolver);
 *  - `mcpRegistry` — build a server config for a known MCP registry (Composio / mcp.run);
 *  - `mcpToolApprovals` — mark MCP tools for approval, producing the M14 `approvals` entries so a
 *    gated MCP tool routes through the (E2E-proven) HITL flow.
 */
import type { HumanInTheLoopOptions } from '../types.js'
import type { McpServersMap } from '../types.js'

/** The request context handed to an MCP resolver (the M7 run-context — opaque per-request data). */
export type McpRequestContext = Record<string, unknown>

/**
 * How the MCP server set is chosen:
 * - a map      — static `@MCP`-style config.
 * - a function — resolved per request from the {@link McpRequestContext} (sync or async).
 */
export type McpSelection =
  | McpServersMap
  | ((ctx: McpRequestContext) => McpServersMap | Promise<McpServersMap>)

/**
 * Resolve the MCP servers for a request. Returns `undefined` when no selection is given. Fails fast
 * if a resolver returns a non-object (error-handling.md). Multi-tenant apps pass a function that
 * reads per-user credentials from `ctx`.
 */
export async function resolveMcpServers(
  selection: McpSelection | undefined,
  ctx: McpRequestContext,
): Promise<McpServersMap | undefined> {
  if (selection === undefined) return undefined
  if (typeof selection !== 'function') return selection
  const resolved: unknown = await selection(ctx)
  if (typeof resolved !== 'object' || resolved === null) {
    throw new Error('[@theokit/agents] MCP resolver must return an McpServersMap object')
  }
  return resolved as McpServersMap
}

/** Config for {@link mcpRegistry}. `registry` selects a known provider. */
export interface McpRegistryConfig {
  registry: 'composio' | 'mcp.run'
  /** The registry API key (kept in the server's env, never logged). */
  apiKey: string
  /** Composio: the app toolkits to expose (e.g. `['github', 'slack']`). */
  apps?: string[]
  /** mcp.run: the profile to connect. */
  profile?: string
}

/**
 * Build an {@link McpServersMap} for a known MCP registry. Emits an `npx`-launched server config with
 * the API key in `env`. Documented registries: **Composio** (`@composio/mcp`) and **mcp.run**
 * (`@mcp.run/cli`). Other registries are wired manually via a raw `@MCP` entry.
 */
export function mcpRegistry(config: McpRegistryConfig): McpServersMap {
  // Compare as a string so an out-of-union value (JS callers) reaches the fail-fast branch.
  const registry: string = config.registry
  if (registry === 'composio') {
    const apps = config.apps ?? []
    return {
      composio: {
        command: 'npx',
        args: ['-y', '@composio/mcp', ...(apps.length > 0 ? ['--apps', apps.join(',')] : [])],
        env: { COMPOSIO_API_KEY: config.apiKey },
      },
    }
  }
  if (registry === 'mcp.run') {
    return {
      'mcp.run': {
        command: 'npx',
        args: [
          '-y',
          '@mcp.run/cli',
          'serve',
          ...(config.profile ? ['--profile', config.profile] : []),
        ],
        env: { MCP_RUN_API_KEY: config.apiKey },
      },
    }
  }
  throw new Error(
    `mcpRegistry: unknown registry ${JSON.stringify(registry)} (supported: 'composio', 'mcp.run').`,
  )
}

/** An MCP tool's approval spec: full {@link HumanInTheLoopOptions} or a bare question string. */
export type McpApprovalSpec = HumanInTheLoopOptions | string

/**
 * Mark MCP tools for human approval (`requireToolApproval`). Returns the `Record<toolName,
 * HumanInTheLoopOptions>` shape the M14 `defineAgent({ approvals })` map consumes — so a gated MCP
 * tool routes through the same (E2E-proven) HITL flow as a native gated tool. A bare string is
 * shorthand for `{ question }`.
 */
export function mcpToolApprovals(
  specs: Record<string, McpApprovalSpec>,
): Record<string, HumanInTheLoopOptions> {
  const out: Record<string, HumanInTheLoopOptions> = {}
  for (const [tool, spec] of Object.entries(specs)) {
    out[tool] = typeof spec === 'string' ? { question: spec } : spec
  }
  return out
}
