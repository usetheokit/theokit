/**
 * M5 (theokit-ai-first) — `theokit agent <name> [message]`: run a scanned agent in the terminal.
 *
 * Scans the top-level `agents/` directory (M2), loads the matched `agents/<name>.ts` through the
 * framework's OWN Vite pipeline (the SAME transpile `theokit dev` uses — legacy `@Agent`/`@Tool`
 * decorators need it; Node's native loader can't transpile TS), resolves the provider apiKey, and
 * runs it in the terminal via the M4 harness (`runAgentInTerminal`). A dev-time surface (ADR 0039 D1),
 * not a CLI product. `deps` is injectable so the fail-fast branches are tested without Vite/an LLM.
 */
import { loadEnv } from '../../config/load-env.js'
import { resolveProvider } from '../../server/agent/provider-resolver.js'
import { runAgentInTerminal } from '../../server/agent/run-terminal-agent.js'
import { scanAgents } from '../../server/scan/agent-scan.js'

export interface AgentCommandDeps {
  projectRoot?: string
  /** Load a TS agent module; defaults to a fresh minimal Vite SSR server (framework transpile). */
  loadModule?: (filePath: string) => Promise<Record<string, unknown>>
  runAgent?: typeof runAgentInTerminal
  resolveApiKey?: () => string
}

export async function agentCommand(
  name: string,
  message: string | undefined,
  deps: AgentCommandDeps = {},
): Promise<{ sawError: boolean }> {
  if (!message || message.trim().length === 0) {
    throw new Error('theokit agent: a message is required. Usage: theokit agent <name> "<message>"')
  }
  const projectRoot = deps.projectRoot ?? process.cwd()
  const agents = scanAgents(projectRoot)
  const agent = agents.find((a) => a.name === name)
  if (!agent) {
    const names = agents.map((a) => a.name).join(', ') || '(none found in agents/)'
    throw new Error(`theokit agent: '${name}' not found. Available agents: ${names}`)
  }

  const runAgent = deps.runAgent ?? runAgentInTerminal
  // Load .env into process.env BEFORE resolving the provider key — parity with `theokit dev`
  // (dev.ts loadEnv), so an app with OPENROUTER_API_KEY in .env works here too (review H1). Skipped
  // when the key is injected (tests) — a temp project has no .env anyway.
  const apiKey =
    deps.resolveApiKey?.() ??
    (() => {
      loadEnv({ cwd: projectRoot, mode: 'development' })
      return resolveProvider().apiKey
    })()

  let loadModule = deps.loadModule
  let dispose: (() => Promise<void>) | undefined
  if (!loadModule) {
    const loader = await createAgentSsrLoader(projectRoot)
    loadModule = loader.load
    dispose = loader.dispose
  }

  try {
    const mod = await loadModule(agent.filePath)
    return await runAgent(mod, apiKey, { message, source: agent.filePath })
  } finally {
    if (dispose) await dispose()
  }
}

/**
 * A minimal middleware-mode Vite server built from the SAME `theoPluginAsync` plugin set `theokit dev`
 * uses (`cli/commands/dev.ts`) — so a class-decorated `agents/<name>.ts` transpiles identically. No
 * HTTP listen, no service orchestration, silent — just `ssrLoadModule`. Caller MUST `dispose()`.
 */
export async function createAgentSsrLoader(projectRoot: string): Promise<{
  load: (p: string) => Promise<Record<string, unknown>>
  dispose: () => Promise<void>
}> {
  const { createServer } = await import('vite')
  const react = (await import('@vitejs/plugin-react')).default
  const { theoPluginAsync } = await import('../../vite-plugin/index.js')
  const { loadConfig } = await import('../../config/load-config.js')
  // Pass the project's ssr/services/optimizeDeps config through, exactly as dev.ts does — so an app
  // that customizes ssr.noExternal transpiles here identically to `theokit dev` (review L1).
  const config = await loadConfig(projectRoot)
  const theoPlugins = await theoPluginAsync({
    root: projectRoot,
    ssr: config.ssr,
    services: config.services,
    viteOptimizeDeps: config.viteOptimizeDeps,
  })
  const server = await createServer({
    root: projectRoot,
    plugins: [react(), ...theoPlugins],
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  })
  return {
    load: (p) => server.ssrLoadModule(p) as Promise<Record<string, unknown>>,
    dispose: async () => {
      // Surface a cleanup failure instead of swallowing it (error-handling.md) — non-fatal, the run
      // already finished, so warn rather than throw past the CLI boundary.
      await server.close().catch((err: unknown) => {
        console.warn('[theokit agent] Vite server cleanup error:', err)
      })
    },
  }
}
