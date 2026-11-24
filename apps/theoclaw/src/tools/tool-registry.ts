import type { CustomTool, McpServerConfig, MemorySettings, Plugin } from '@theokit/sdk'
import { createACPTool } from 'theokit/server/agent'
import { assistantAgentTools, assistantWorkerTools } from '@theokit/agents/presets'
import type { ToolScope } from '@theokit/agents/tool-scope'
import { createScreenshotLogbookTool } from '@theokit/sdk-tools/screenshot-logbook'
import { createShellTool, createWebSearchTool } from '@theokit/agents/tools'

import { widgetTool } from '../canvas/widget.js'
import type { TurnAgent } from '../agent-port.js'
import { acpAgentEnv, agentTransport } from './acp-transport.js'
import { acpPermissionHandler, type AcpPermissionOptions } from './acp-permission.js'
import { browserServer } from './browser-server.js'
import { codeModeTool, delegateAllTool, delegateTool, runWorker, type CreateWorker } from './code-mode-tools.js'
import { cloudWorkerPort, codingWorkerPort, codingWorkersAvailable } from './coding-worker.js'
import { computerTool } from './computer-tool.js'
import { execApprovalPlugin, type ExecApprovalOptions } from './exec-approval.js'
import { questionTool, taskTools } from './control-tools.js'
import { pathVetoPlugin, toolScopeOf } from './path-veto.js'
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
  /** Appended to the agent's system prompt; absent adds nothing. */
  readonly systemPromptSuffix?: string
  /** SDK memory for this agent; absent leaves it off (`theoClawAgentOptions` owns that default). */
  readonly memory?: MemorySettings
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
      env: acpAgentEnv(),
      transportFactory: agentTransport,
    }),
  )
}

/** `web_search` over the adapter the settings chose, or none when search is off. */
function webSearchTool(settings: ToolSettings): CustomTool | undefined {
  const { adapter } = settings.search
  return adapter === undefined ? undefined : createWebSearchTool({ search: adapter })
}

/** The sandboxed shell over the settings' backend; `shell_exec`. */
export function shellToolFor(settings: ToolSettings): CustomTool {
  return bindDuplicated(toolScopeOf(settings), createShellTool)()
}

/** What the assistant preset needs of the settings: the root, the scope, the modes and the web. */
function presetOptions(settings: ToolSettings, scope: ToolScope = toolScopeOf(settings)) {
  const search = webSearchTool(settings)
  return {
    toolRoot: settings.toolRoot,
    sandboxMode: settings.sandboxMode,
    scope,
    hostTools: settings.hostTools,
    fetchImpl: settings.fetchImpl,
    ...(settings.lookup === undefined ? {} : { lookup: settings.lookup }),
    ...(search === undefined ? {} : { webSearch: search }),
  }
}

/** The two read-only file tools: the `minimal` tool profile. */
export function fileReadTools(settings: ToolSettings): CustomTool[] {
  return [...assistantAgentTools({ ...presetOptions(settings), hostTools: false, profile: 'minimal' }).tools]
}

/**
 * The tools a script (`run_code`) or a `delegate_all` worker may hold: they read the tool root or
 * the web and change nothing on the host (plan D3). Host-changing tools wait for exec approval.
 */
export function readOnlyTools(settings: ToolSettings): CustomTool[] {
  return assistantWorkerTools(presetOptions(settings))
}

/**
 * `scope.bind` for a factory whose sandbox option is typed by another copy of `@theokit/sdk`.
 * SDK 8 declares optional OpenTelemetry peers, which this app resolves differently from the
 * framework packages, so pnpm installs the SDK twice and the two `SandboxBackend` classes no longer
 * unify. The scope supplies the real values at run time; only the type identity differs.
 */
function bindDuplicated<O>(scope: ToolScope, factory: (options: O) => CustomTool): (overrides?: Partial<O>) => CustomTool {
  return scope.bind(factory as never) as unknown as (overrides?: Partial<O>) => CustomTool
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
export function buildTools(settings: ToolSettings, permission: AcpPermissionOptions = {}, scope: ToolScope = toolScopeOf(settings)): CustomTool[] {
  // The ChatGPT subscription wire rejects an image in a tool result, so `view_image` is not offered there (`imageResults`).
  const { tools } = assistantAgentTools({
    ...presetOptions(settings, scope),
    gitDiff: 'when-enforced',
    gitRepository: settings.gitRepository,
    sandboxEnforced: settings.sandboxEnforced,
    ...(settings.imageResults === undefined ? {} : { imageResults: settings.imageResults }),
    // The file writers take a project root and no sandbox, so `read-only` leaves them out (plan D3); the shell stays.
    ...(settings.interactive === undefined ? {} : { interactive: settings.interactive }),
    extra: [widgetTool()],
  })
  if (settings.hostTools && settings.sandboxMode !== 'read-only') {
    tools.push(createScreenshotLogbookTool({ projectRoot: settings.toolRoot }))
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
  createCoder?: (tools: CustomTool[]) => Promise<TurnAgent>,
): AgentToolOptions {
  const scope = toolScopeOf(settings)
  const tools = [...buildTools(settings, execApproval === undefined ? {} : { ask: execApproval.ask }, scope), ...extra]
  if (createWorker !== undefined && buildDescriber !== undefined && settings.computer !== undefined) {
    // Only where a worker factory exists, which is the `/control` agent: the screenshot's describer is built by it (B-676 Q1).
    tools.push(computerTool(settings.computer, buildDescriber))
  }
  if (createWorker !== undefined) {
    // A coding task gets its own git worktree and branch (OC-83): only where files may be written in a repository.
    const coder =
      createCoder !== undefined && codingWorkersAvailable(settings)
        ? codingWorkerPort(settings, readOnlyTools, (workerTools, task, signal) => runWorker(() => createCoder(workerTools), task, signal))
        : undefined
    const cloud =
      createCoder !== undefined && codingWorkersAvailable(settings)
        ? cloudWorkerPort(settings, readOnlyTools, (workerTools, task, signal) => runWorker(() => createCoder(workerTools), task, signal))
        : undefined
    tools.push(
      codeModeTool(readOnlyTools(settings), settings),
      delegateAllTool(createWorker, coder, cloud),
      delegateTool(createWorker, coder, cloud),
      questionTool(),
      ...taskTools(),
    )
  }
  // The exec gate is installed only with host tools on and exec options given (the composition gives them with a state
  // directory). Without an asker it refuses what no saved approval or reviewer allowed.
  const plugins = [pathVetoPlugin(settings, scope), provenanceGuardPlugin(), ...(execApproval !== undefined && settings.hostTools ? [execApprovalPlugin(execApproval)] : [])]
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
  return { tools: readOnlyTools(settings), plugins: [pathVetoPlugin(settings), provenanceGuardPlugin()] }
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
    async (tools) => build({ ...workerToolOptions(settings), tools }),
  )
}
