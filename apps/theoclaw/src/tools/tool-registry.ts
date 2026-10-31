import type { CustomTool, Plugin } from '@theokit/sdk'
import { bindToolScope } from '@theokit/agents/tool-scope'
import {
  createApplyPatchTool,
  createBraveWebSearchAdapter,
  createEditFileTool,
  createGenericHttpSearchAdapter,
  createGitDiffTool,
  createListDirTool,
  createReadFileTool,
  createShellTool,
  createTodolistTool,
  createViewImageTool,
  createWebFetchTool,
  createWebSearchTool,
  createWriteFileTool,
} from '@theokit/agents/tools'

import type { TurnAgent } from '../agent-port.js'
import { codeModeTool, delegateAllTool, type CreateWorker } from './code-mode-tools.js'
import { pathVetoPlugin } from './path-veto.js'
import type { ToolSettings } from './tool-settings.js'

/**
 * The tools and plugins of one agent. Which builtins every agent is denied (the `shell`) is not
 * here: `theoClawAgentOptions` owns that policy, for an agent with tools and one without alike.
 */
export interface AgentToolOptions {
  readonly tools: readonly CustomTool[]
  readonly plugins: readonly Plugin[]
}

/** `web_search` over the adapter the settings chose, or none when search is off. */
function webSearchTool(settings: ToolSettings): CustomTool | undefined {
  const { kind, url, key } = settings.search
  if (kind === 'brave') return createWebSearchTool({ search: createBraveWebSearchAdapter({ apiKey: key, fetchImpl: settings.fetchImpl }) })
  if (kind === 'generic') {
    return createWebSearchTool({ search: createGenericHttpSearchAdapter({ apiKey: key, endpoint: url, fetchImpl: settings.fetchImpl }) })
  }
  return undefined
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
  const tools: CustomTool[] = [scope.bind(createReadFileTool)(), scope.bind(createListDirTool)(), createWebFetchTool()]
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
 * - write, edit, apply_patch and the sandboxed shell only with `THEOCLAW_HOST_TOOLS=on`.
 *
 * The interactive shell and its stdin tool are never registered: they take a PTY, not this backend.
 */
export function buildTools(settings: ToolSettings): CustomTool[] {
  const scope = scopeOf(settings)
  const tools: CustomTool[] = [
    scope.bind(createReadFileTool)(),
    scope.bind(createListDirTool)(),
    scope.bind(createViewImageTool)(),
    createWebFetchTool(),
    // `TodolistTool` types its handler with the todo input union; the SDK validates the model's
    // arguments against the tool's own `inputSchema` before calling it, so the wider type is safe.
    createTodolistTool() as unknown as CustomTool,
  ]
  const search = webSearchTool(settings)
  if (search !== undefined) tools.push(search)
  if (settings.gitRepository && settings.sandboxEnforced) tools.push(scope.bind(createGitDiffTool)())
  if (settings.hostTools) {
    tools.push(
      scope.bind(createWriteFileTool)(),
      scope.bind(createEditFileTool)(),
      scope.bind(createApplyPatchTool)(),
      scope.bind(createShellTool)(),
    )
  }
  return tools
}

/**
 * The options of one agent: a fresh tool list (a todolist is never shared between two agents), then
 * the `extra` tools the composition root passes in (the workflow tools, B-387), and the
 * state-directory veto. Given a worker factory (a `/control` agent's, B-386), the list also holds
 * `run_code` over the read-only tools and `delegate_all` over that factory's workers.
 */
export function agentToolOptions(
  settings: ToolSettings,
  extra: readonly CustomTool[] = [],
  createWorker?: CreateWorker,
): AgentToolOptions {
  const tools = [...buildTools(settings), ...extra]
  if (createWorker !== undefined) {
    tools.push(codeModeTool(readOnlyTools(settings), settings), delegateAllTool(createWorker))
  }
  return { tools, plugins: [pathVetoPlugin(settings)] }
}

/** A worker's options: the read-only tools and the veto, never `run_code` or `delegate_all` (FR-010). */
function workerToolOptions(settings: ToolSettings): AgentToolOptions {
  return { tools: readOnlyTools(settings), plugins: [pathVetoPlugin(settings)] }
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
): AgentToolOptions {
  return agentToolOptions(settings, extra, async () => build(workerToolOptions(settings)))
}

/**
 * The options of an agent that holds no tool at all: a WebChat turn's, since whoever holds the
 * WebChat token writes its prompt, as every chat surface (B-382). Frozen to the arrays, so no caller
 * can add a tool to the one instance every such agent shares.
 */
export const NO_TOOL_OPTIONS: AgentToolOptions = Object.freeze({
  tools: Object.freeze([]),
  plugins: Object.freeze([]),
})
