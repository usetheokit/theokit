import type { CustomTool, McpServerConfig, Plugin } from '@theokit/sdk'
import { createACPTool } from 'theokit/server/agent'
import { bindToolScope } from '@theokit/agents/tool-scope'
import { createExtractDocumentTool } from '@theokit/sdk-tools/extract-document'
import { createGithubLinkPreviewTool } from '@theokit/sdk-tools/github-link-preview'
import { createReadPdfTool } from '@theokit/sdk-tools/read-pdf'
import { createScreenshotLogbookTool } from '@theokit/sdk-tools/screenshot-logbook'
import {
  createApplyPatchTool,
  createBraveWebSearchAdapter,
  createEditFileTool,
  createGenericHttpSearchAdapter,
  createGitDiffTool,
  createInteractiveShellTool,
  createListDirTool,
  createReadFileTool,
  createSearxngWebSearchAdapter,
  createShellTool,
  createTavilyWebSearchAdapter,
  createTodolistTool,
  createViewImageTool,
  createWebFetchTool,
  createWebSearchTool,
  createWriteFileTool,
  createWriteStdinTool,
} from '@theokit/agents/tools'

import { widgetTool } from '../canvas/widget.js'
import type { TurnAgent } from '../agent-port.js'
import { scrubbedAgentTransport } from './acp-transport.js'
import { acpPermissionHandler, type AcpPermissionOptions } from './acp-permission.js'
import { browserServer } from './browser-server.js'
import { codeModeTool, delegateAllTool, delegateTool, type CreateWorker } from './code-mode-tools.js'
import { computerTool } from './computer-tool.js'
import { execApprovalPlugin, type ExecApprovalOptions } from './exec-approval.js'
import { questionTool, taskTools } from './control-tools.js'
import { loopDetectionPlugin } from './loop-detection.js'
import { pathVetoPlugin } from './path-veto.js'
import { provenanceGuardPlugin } from './provenance-guard.js'
import type { ToolSettings } from './tool-settings.js'

/**
 * The tools and plugins of one agent. Which builtins every agent is denied (the `shell`) is not
 * here: `theoClawAgentOptions` owns that policy, for an agent with tools and one without alike.
 */
export interface AgentToolOptions {
  readonly tools: readonly CustomTool[]
  readonly plugins: readonly Plugin[]
  /** The browser server with `THEOCLAW_BROWSER=on` (B-383) and the MCP servers of `THEOCLAW_EXTERNAL_TOOLS`; absent when neither names one. */
  readonly mcpServers?: Readonly<Record<string, McpServerConfig>>
  /** Appended to the agent's system prompt: the facts earlier sessions kept (OC-56); absent adds nothing. */
  readonly systemPromptSuffix?: string
}

/** One `createACPTool` per agent of the external tools file, each run in the tool root without the host secrets. */
function acpTools(settings: ToolSettings, permission: AcpPermissionOptions): CustomTool[] {
  return settings.external.acpAgents.map((agent) =>
    createACPTool({
      name: agent.name,
      description: agent.description,
      command: agent.command,
      ...(agent.args === undefined ? {} : { args: [...agent.args] }),
      ...(agent.timeoutMs === undefined ? {} : { timeoutMs: agent.timeoutMs }),
      cwd: settings.toolRoot,
      onPermissionRequest: acpPermissionHandler(agent.name, permission),
      transportFactory: scrubbedAgentTransport,
    }),
  )
}

/** `web_search` over the adapter the settings chose, or none when search is off. */
function webSearchTool(settings: ToolSettings): CustomTool | undefined {
  const { kind, url, key } = settings.search
  if (kind === 'brave') return createWebSearchTool({ search: createBraveWebSearchAdapter({ apiKey: key, fetchImpl: settings.fetchImpl }) })
  if (kind === 'searxng') return createWebSearchTool({ search: createSearxngWebSearchAdapter({ baseUrl: url, fetchImpl: settings.fetchImpl }) })
  if (kind === 'tavily') return createWebSearchTool({ search: createTavilyWebSearchAdapter({ apiKey: key, fetchImpl: settings.fetchImpl }) })
  if (kind === 'generic') {
    return createWebSearchTool({ search: createGenericHttpSearchAdapter({ apiKey: key, endpoint: url, fetchImpl: settings.fetchImpl }) })
  }
  return undefined
}

/** `web_fetch` on the settings' fetch and DNS lookup, its SSRF screen kept (B-398 FR-003). */
function webFetchTool(settings: ToolSettings): CustomTool {
  return createWebFetchTool({ fetchImpl: settings.fetchImpl, ...(settings.lookup === undefined ? {} : { lookup: settings.lookup }) })
}

function scopeOf(settings: ToolSettings): ReturnType<typeof bindToolScope> {
  return bindToolScope({
    projectRoot: settings.toolRoot,
    writeRoot: settings.toolRoot,
    sandbox: settings.sandbox,
    mode: settings.mode,
  })
}

/**
 * The tools a script (`run_code`) or a `delegate_all` worker may hold: they read the tool root or
 * the web and change nothing on the host (plan D3). Host-changing tools wait for exec approval.
 */
export function readOnlyTools(settings: ToolSettings): CustomTool[] {
  const scope = scopeOf(settings)
  const tools: CustomTool[] = [scope.bind(createReadFileTool)(), scope.bind(createListDirTool)(), webFetchTool(settings)]
  const search = webSearchTool(settings)
  if (search !== undefined) tools.push(search)
  return tools
}

/**
 * The tools of one agent, every one a published factory from `@theokit/agents/tools`, bound to the
 * tool root and to the one sandbox backend built at start (plan D2, D3):
 *
 * - always the five read-only tools, and web search when a search key is set;
 * - `git_diff` only when the tool root is a repository AND the sandbox is enforced, since git runs
 *   repository-configured helpers (`diff.external`) that only the kernel sandbox keeps in the root;
 * - the sandboxed shell only with `THEOCLAW_HOST_TOOLS=on`, and write, edit and apply_patch with it
 *   unless `THEOCLAW_SANDBOX=read-only`;
 * - one ACP tool per agent `THEOCLAW_EXTERNAL_TOOLS` names, every permission it asks put to the owner (refused without an asker).
 *
 * The interactive shell and its stdin tool take a PTY, not this backend: they are registered only
 * when `settings.interactive` is set, which `withInteractiveShell` does once a real session is
 * proven to write in the tool root and nowhere else on this host.
 */
export function buildTools(settings: ToolSettings, permission: AcpPermissionOptions = {}): CustomTool[] {
  const scope = scopeOf(settings)
  const tools: CustomTool[] = [
    scope.bind(createReadFileTool)(),
    scope.bind(createListDirTool)(),
    scope.bind(createViewImageTool)(),
    // Documents and PDFs are read from the tool root, GitHub links over the settings' fetch (OC-69).
    createReadPdfTool({ projectRoot: settings.toolRoot }),
    createExtractDocumentTool({ projectRoot: settings.toolRoot }),
    createGithubLinkPreviewTool({ fetchImpl: settings.fetchImpl }),
    webFetchTool(settings),
    // `TodolistTool` types its handler with the todo input union; the SDK validates the model's
    // arguments against the tool's own `inputSchema` before calling it, so the wider type is safe.
    createTodolistTool() as unknown as CustomTool,
    widgetTool(),
  ]
  const search = webSearchTool(settings)
  if (search !== undefined) tools.push(search)
  if (settings.gitRepository && settings.sandboxEnforced) tools.push(scope.bind(createGitDiffTool)())
  if (settings.hostTools) {
    // The file writers take a project root and no sandbox, so `read-only` can only leave them out
    // (plan D3); the shell stays, confined by the read-only backend.
    if (settings.sandboxMode !== 'read-only') {
      tools.push(scope.bind(createWriteFileTool)(), scope.bind(createEditFileTool)(), scope.bind(createApplyPatchTool)(), createScreenshotLogbookTool({ projectRoot: settings.toolRoot }))
    }
    tools.push(scope.bind(createShellTool)())
    if (settings.interactive !== undefined) {
      tools.push(createInteractiveShellTool({ interactive: settings.interactive }), createWriteStdinTool({ interactive: settings.interactive }))
    }
  }
  tools.push(...acpTools(settings, permission))
  return tools
}

/**
 * The options of one agent: a fresh tool list (a todolist is never shared between two agents), then
 * the `extra` tools the composition root passes in (the workflow tools, B-387), the state-directory
 * veto, and the MCP servers: the browser server when `THEOCLAW_BROWSER=on` (B-383) and a copy of the
 * external ones when the file names any, so an agent without them gets exactly the options it got
 * before them. Given a worker factory (a `/control` agent's, B-386), the list also holds `run_code`
 * over the read-only tools, `delegate_all` and `delegate` over that factory's workers, `question`
 * with no asker and the two task tools over a registry of its own (B-611). A chat agent holds no
 * tool and no server.
 */
export function agentToolOptions(
  settings: ToolSettings,
  extra: readonly CustomTool[] = [],
  createWorker?: CreateWorker,
  buildDescriber?: () => Promise<TurnAgent>,
  execApproval?: ExecApprovalOptions,
): AgentToolOptions {
  const tools = [...buildTools(settings, execApproval === undefined ? {} : { ask: execApproval.ask }), ...extra]
  if (createWorker !== undefined && buildDescriber !== undefined && settings.computer !== undefined) {
    // Only where a worker factory exists, which is the `/control` agent: the screenshot's describer is built by it (B-676 Q1).
    tools.push(computerTool(settings.computer, buildDescriber))
  }
  if (createWorker !== undefined) {
    tools.push(
      codeModeTool(readOnlyTools(settings), settings),
      delegateAllTool(createWorker),
      delegateTool(createWorker),
      questionTool(),
      ...taskTools(),
    )
  }
  // The exec gate is installed only with host tools on and exec options given (the composition gives them with a state
  // directory). Without an asker it refuses what no saved approval or reviewer allowed.
  const plugins = [pathVetoPlugin(settings), provenanceGuardPlugin(), loopDetectionPlugin(), ...(execApproval !== undefined && settings.hostTools ? [execApprovalPlugin(execApproval)] : [])]
  const base = { tools, plugins }
  const servers = mcpServersOf(settings)
  return Object.keys(servers).length === 0 ? base : { ...base, mcpServers: servers }
}

/**
 * The browser server and the external ones in one map. The external tools file cannot name a server
 * `browser` (`external-tools.ts`), so neither replaces the other.
 */
function mcpServersOf(settings: ToolSettings): Record<string, McpServerConfig> {
  return {
    ...settings.external.mcpServers,
    ...(settings.browser === undefined ? {} : { browser: browserServer(settings.browser) }),
  }
}

/**
 * A worker's options: the read-only tools and the veto, never `run_code` or `delegate_all` (FR-010).
 * A scheduled run's agent gets the same (B-396), so it holds no schedule tool either.
 */
export function workerToolOptions(settings: ToolSettings): AgentToolOptions {
  return { tools: readOnlyTools(settings), plugins: [pathVetoPlugin(settings), provenanceGuardPlugin(), loopDetectionPlugin()] }
}

/**
 * A `/control` agent's options: its tools and the `extra` ones, plus `run_code` and `delegate_all`,
 * whose workers `build` builds, the same factory that builds the `/control` agent, with
 * `workerToolOptions` (plan D4).
 */
export function controlAgentToolOptions(
  settings: ToolSettings,
  build: (toolOptions: AgentToolOptions) => TurnAgent | Promise<TurnAgent>,
  extra: readonly CustomTool[] = [],
  execApproval?: ExecApprovalOptions,
): AgentToolOptions {
  return agentToolOptions(
    settings,
    extra,
    async () => build(workerToolOptions(settings)),
    // The screenshot's describer holds no tool and no plugin: it can only answer (B-676 D1).
    async () => build({ tools: [], plugins: [] }),
    execApproval,
  )
}
