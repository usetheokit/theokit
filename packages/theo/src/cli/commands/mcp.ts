/**
 * `theokit mcp <agent>` — expose a scanned agent as an MCP server over stdio.
 *
 * The stdio sibling of the M16 HTTP route (`POST /api/agents/<name>/mcp`): a desktop MCP client
 * (e.g. Claude Desktop) spawns this command and speaks newline-delimited JSON-RPC over the pipe.
 * It reuses the framework's OWN `serveMcpStdio` / `handleMcpJsonRpc` (no LLM call, no runtime — a
 * TRANSPORT, like the HTTP route). `deps` is injectable so the routing is tested without Vite/stdin.
 */
import { createInterface } from 'node:readline'

import { extractAppResources } from '../../server/agent/mcp-app-resources.js'
import { type StdioStreams, serveMcpStdio } from '../../server/agent/mcp-stdio.js'
import { scanAgents } from '../../server/scan/agent-scan.js'

import { createAgentSsrLoader } from './agent.js'

export interface McpCommandDeps {
  projectRoot?: string
  /** Load a TS agent module; defaults to the framework's Vite SSR loader (same transpile as dev). */
  loadModule?: (filePath: string) => Promise<Record<string, unknown>>
  /** stdio streams; defaults to `readline(process.stdin)` + `process.stdout`. Injected in tests. */
  streams?: StdioStreams
  /** Agents dir name (config `agentsDir`); defaults to the loaded config's value ("agents"). Tests inject it. */
  agentsDir?: string
}

export async function mcpCommand(name: string, deps: McpCommandDeps = {}): Promise<void> {
  const projectRoot = deps.projectRoot ?? process.cwd()
  // #95 follow-up — resolve agents dir from config (default "agents") so `agentsDir` is honored here too.
  const agentsDir =
    deps.agentsDir ??
    (await (await import('../../config/load-config.js')).loadConfig(projectRoot)).agentsDir
  const agent = scanAgents(projectRoot, agentsDir).find((a) => a.name === name)
  if (!agent) {
    const names = scanAgents(projectRoot, agentsDir)
      .map((a) => a.name)
      .join(', ')
    throw new Error(
      `theokit mcp: agent '${name}' not found. Available: ${names || '(none in agents/)'}`,
    )
  }

  let loadModule = deps.loadModule
  let dispose: (() => Promise<void>) | undefined
  if (!loadModule) {
    const loader = await createAgentSsrLoader(projectRoot)
    loadModule = loader.load
    dispose = loader.dispose
  }

  const streams =
    deps.streams ??
    ({
      lines: createInterface({ input: process.stdin }),
      write: (line: string) => process.stdout.write(line),
    } satisfies StdioStreams)

  try {
    const mod = await loadModule(agent.filePath)
    await serveMcpStdio(mod, agent.name, extractAppResources(mod), streams)
  } finally {
    if (dispose) await dispose()
  }
}
