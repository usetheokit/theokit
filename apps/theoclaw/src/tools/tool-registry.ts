import type { BuiltinToolName, CustomTool, Plugin } from '@theokit/sdk'
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

import { pathVetoPlugin } from './path-veto.js'
import type { ToolSettings } from './tool-settings.js'

/** What the process spreads into `Agent.create` for one agent. */
export interface AgentToolOptions {
  readonly tools: CustomTool[]
  readonly plugins: Plugin[]
  readonly withheldBuiltinTools: BuiltinToolName[]
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
  const scope = bindToolScope({
    projectRoot: settings.toolRoot,
    writeRoot: settings.toolRoot,
    sandbox: settings.sandbox,
    mode: settings.mode,
  })
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
 * The options of one agent: a fresh tool list (a todolist is never shared between two agents), the
 * state-directory veto, and the SDK's unsandboxed builtin `shell` withheld from the catalog.
 */
export function agentToolOptions(settings: ToolSettings): AgentToolOptions {
  return { tools: buildTools(settings), plugins: [pathVetoPlugin(settings)], withheldBuiltinTools: ['shell'] }
}

/**
 * The options of an agent that holds no tool at all: a chat reply's, since anyone who can message
 * the bot writes its prompt (no sender allowlist yet, B-371). The builtin `shell` is withheld too.
 */
export const NO_TOOL_OPTIONS: AgentToolOptions = Object.freeze({ tools: [], plugins: [], withheldBuiltinTools: ['shell' as const] })
