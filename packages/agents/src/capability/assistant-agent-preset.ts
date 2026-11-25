import type { CustomTool } from '@theokit/sdk'
import type { InteractiveBackend } from '@theokit/sdk/interactive'
import { createSandboxBackend, type SandboxMode, type SandboxProvider } from '@theokit/sdk/sandbox'
import {
  createApplyPatchTool,
  createEditFileTool,
  createGitDiffTool,
  createInteractiveShellTool,
  createListDirTool,
  createReadFileTool,
  createShellTool,
  createTodolistTool,
  createViewImageTool,
  createWebFetchTool,
  createWriteFileTool,
  createWriteStdinTool,
} from '@theokit/sdk-tools'
import { createExtractDocumentTool } from '@theokit/sdk-tools/extract-document'
import { createGithubLinkPreviewTool } from '@theokit/sdk-tools/github-link-preview'
import { createReadPdfTool } from '@theokit/sdk-tools/read-pdf'

import { bindToolScope, sandboxWritePolicy, type ToolScope } from '../tools/tool-scope.js'

import { WithheldBuiltinToolsCapability } from './agent-capabilities.js'
import { ToolsCapability } from './capabilities.js'
import { type OffTool, OffToolsCapability } from './capability.js'
import { CapabilityPreset } from './registry.js'
import { Toolset } from './toolset.js'

/** The named tiers of an assistant's tools: each one holds the tools of the one before it. */
export type AssistantAgentProfile = 'minimal' | 'messaging' | 'coding' | 'full'

export interface AssistantAgentPresetOptions {
  /** The root every tool reads from (and writes to, when the mode allows writes). */
  readonly toolRoot: string
  /** `read-only` registers no writer; the shell is registered only with `hostTools`. */
  readonly sandboxMode: SandboxMode
  /** Overrides the confinement; defaults to the sandbox backend of `sandboxMode` over `toolRoot`. */
  readonly sandbox?: SandboxProvider
  /** A scope the caller already bound (protected paths, another write root); replaces `toolRoot`, `sandbox` and the mode of the scope. */
  readonly scope?: ToolScope
  /** The shell and the writers are registered only when true. */
  readonly hostTools: boolean
  /** A `web_search` tool the caller built (only when a provider is configured). */
  readonly webSearch?: CustomTool
  /** The interactive backend (a PTY); without one no `interactive_shell` / `write_stdin`. */
  readonly interactive?: InteractiveBackend
  /** `when-enforced` registers `git_diff` when `gitRepository` and `sandboxEnforced` both hold; the default is `off`. */
  readonly gitDiff?: 'when-enforced' | 'off'
  /** The tool root is a git repository. */
  readonly gitRepository?: boolean
  /** The sandbox is a kernel sandbox, one that keeps repository-configured git helpers in the root. */
  readonly sandboxEnforced?: boolean
  /** Fetch for `web_fetch` and `github_link_preview`; defaults to the global one. */
  readonly fetchImpl?: typeof fetch
  /** The DNS lookup `web_fetch` screens a host with. */
  readonly lookup?: NonNullable<Parameters<typeof createWebFetchTool>[0]>['lookup']
  /** False leaves `view_image` out, for a wire that rejects an image in a tool result. */
  readonly imageResults?: boolean
  /** Tools appended after the preset's own. */
  readonly extra?: readonly CustomTool[]
  /** Narrows the registered tools to this tier; absent registers them all. */
  readonly profile?: AssistantAgentProfile
}

/** The tools {@link assistantAgentPreset} registers, the ones it leaves off with a reason, and the tiers. */
export interface AssistantAgentTools {
  readonly tools: CustomTool[]
  readonly off: OffTool[]
  readonly toolset: Toolset<CustomTool>
}

function scopeOf(
  o: Pick<AssistantAgentPresetOptions, 'toolRoot' | 'sandboxMode' | 'sandbox' | 'scope'>,
): ToolScope {
  return (
    o.scope ??
    bindToolScope({
      projectRoot: o.toolRoot,
      sandbox: o.sandbox ?? createSandboxBackend({ mode: o.sandboxMode, workDir: o.toolRoot }),
      mode: o.sandboxMode,
    })
  )
}

function webFetchOf(o: Pick<AssistantAgentPresetOptions, 'fetchImpl' | 'lookup'>): CustomTool {
  return createWebFetchTool({
    ...(o.fetchImpl === undefined ? {} : { fetchImpl: o.fetchImpl }),
    ...(o.lookup === undefined ? {} : { lookup: o.lookup }),
  })
}

/** The read-only tools a script or a delegated worker may hold: read and list the root, fetch and search the web. */
export function assistantWorkerTools(
  o: Pick<AssistantAgentPresetOptions, 'toolRoot' | 'sandboxMode' | 'webSearch'> &
    Partial<Pick<AssistantAgentPresetOptions, 'sandbox' | 'scope' | 'fetchImpl' | 'lookup'>>,
): CustomTool[] {
  const scope = scopeOf(o)
  const tools = [scope.bind(createReadFileTool)(), scope.bind(createListDirTool)(), webFetchOf(o)]
  if (o.webSearch !== undefined) tools.push(o.webSearch)
  return tools
}

/** The tool half of {@link assistantAgentPreset}, for a consumer that composes its own agent around the tools. */
export function assistantAgentTools(o: AssistantAgentPresetOptions): AssistantAgentTools {
  const scope = scopeOf(o)
  const off: OffTool[] = []
  const tools: CustomTool[] = [
    scope.bind(createReadFileTool)(),
    scope.bind(createListDirTool)(),
    createReadPdfTool({ projectRoot: o.toolRoot }),
    createExtractDocumentTool({ projectRoot: o.toolRoot }),
    createGithubLinkPreviewTool({
      ...(o.fetchImpl === undefined ? {} : { fetchImpl: o.fetchImpl }),
    }),
    webFetchOf(o),
    // The todolist types its handler with the todo input union; the SDK validates the model's
    // arguments against the tool's own `inputSchema` first, so the wider type is safe.
    createTodolistTool(),
  ]
  if (o.imageResults === false) {
    off.push({ name: 'view_image', reason: 'the model wire rejects an image in a tool result' })
  } else {
    tools.splice(2, 0, scope.bind(createViewImageTool)())
  }
  if (o.webSearch === undefined) {
    off.push({ name: 'web_search', reason: 'no search provider is configured' })
  } else {
    tools.push(o.webSearch)
  }
  if (o.gitDiff === 'when-enforced' && o.gitRepository === true && o.sandboxEnforced === true) {
    tools.push(scope.bind(createGitDiffTool)())
  } else {
    off.push({
      name: 'git_diff',
      reason:
        o.gitDiff === 'when-enforced'
          ? 'it needs a git repository under an enforced sandbox'
          : 'it was not asked for',
    })
  }
  const writes = sandboxWritePolicy(o.sandboxMode, o.toolRoot).writes
  const writers = ['write_file', 'edit_file', 'apply_patch']
  const interactiveNames = ['interactive_shell', 'write_stdin']
  if (!o.hostTools) {
    const reason = 'host tools are off'
    for (const name of ['shell_exec', ...writers, ...interactiveNames]) off.push({ name, reason })
  } else {
    if (writes) {
      tools.push(
        scope.bind(createWriteFileTool)(),
        scope.bind(createEditFileTool)(),
        scope.bind(createApplyPatchTool)(),
      )
    } else {
      for (const name of writers)
        off.push({ name, reason: `the ${o.sandboxMode} sandbox grants no writes` })
    }
    // `sandbox` comes from the bound scope, so the shell cannot be assembled unconfined.
    tools.push(scope.bind(createShellTool)())
    if (o.interactive === undefined) {
      for (const name of interactiveNames)
        off.push({ name, reason: 'no interactive backend was supplied' })
    } else {
      const backend = o.interactive
      // A provider function, not the backend: the SDK tells the two apart by `instanceof`.
      const interactive = () => backend
      tools.push(createInteractiveShellTool({ interactive }), createWriteStdinTool({ interactive }))
    }
  }
  tools.push(...(o.extra ?? []))

  const has = new Set(tools.map((tool) => tool.name))
  const only = (names: readonly string[]): string[] => names.filter((name) => has.has(name))
  const coding = tools.map((tool) => tool.name).filter((name) => !interactiveNames.includes(name))
  const toolset = Toolset.from(tools, {
    minimal: only(['read_file', 'list_dir']),
    messaging: only(['read_file', 'list_dir', 'web_fetch', 'web_search']),
    coding,
    full: [...has],
  })
  return {
    tools: o.profile === undefined ? tools : [...toolset.narrow(o.profile).all()],
    off,
    toolset,
  }
}

/**
 * A chat assistant, as ONE capability: read, list, document, web and todolist tools always; the shell
 * and the writers only with host tools (the writers not in `read-only`); the SDK's built-in shell
 * withheld; every tool left out reported with its reason. Approval is left to the caller.
 */
export function assistantAgentPreset(o: AssistantAgentPresetOptions): CapabilityPreset {
  const { tools, off } = assistantAgentTools(o)
  return new CapabilityPreset('preset:assistant-agent', [
    new ToolsCapability(tools),
    new OffToolsCapability(off),
    new WithheldBuiltinToolsCapability(['shell']),
  ])
}
