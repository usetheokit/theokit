import { join } from 'node:path'

import { bindToolScope, createPathVetoPlugin, vetoPathCall } from '@theokit/agents/tool-scope'
import type { PathVetoOptions, ToolScope } from '@theokit/agents/tool-scope'
import type { GeneralPlugin } from './general-plugin.js'
import type { ToolSettings } from './tool-settings.js'

/** The workspace directories the SDK and TheoClaw keep their state in. */
const STATE_DIRECTORIES = ['.theokit', '.theoclaw'] as const

/** TheoClaw's wording of the framework's refusals. */
const WORDING: PathVetoOptions = {
  prefix: 'theoclaw: ',
  enters: (value, protectedPath) => `${value} enters the workspace's ${STATE_DIRECTORIES.find((name) => protectedPath.endsWith(name)) ?? protectedPath} directory`,
}

/**
 * The tool root and the sandbox every file tool is bound to, with the workspace's state
 * directories protected: the one scope the tools and the path veto are both derived from.
 */
export function toolScopeOf(settings: ToolSettings): ToolScope {
  return bindToolScope({
    projectRoot: settings.toolRoot,
    writeRoot: settings.toolRoot,
    sandbox: settings.sandbox,
    mode: settings.mode,
    protectedPaths: STATE_DIRECTORIES.map((state) => join(settings.workspace, state)),
  })
}

/**
 * The veto for one tool call made outside the SDK's dispatch: the refusal message, or `undefined`
 * when the call may run. A script's `api` call runs the tool's handler directly and skips the
 * `pre_tool_call` plugins, so `run_code`'s permission gate asks this instead (plan D3); the plugin
 * below asks the same framework check, so both give one verdict. The MCP server runs the plugin.
 */
export function vetoToolCall(name: string, args: unknown, settings: ToolSettings): string | undefined {
  return vetoPathCall(toolScopeOf(settings), name, args, WORDING)
}

/**
 * The framework's path veto over the workspace's `.theokit` and `.theoclaw` (plan D2, FR-006),
 * under TheoClaw's plugin name and refusal wording.
 */
export function pathVetoPlugin(settings: ToolSettings, scope: ToolScope = toolScopeOf(settings)): GeneralPlugin {
  return { ...createPathVetoPlugin(scope, WORDING), name: 'theoclaw-path-veto' }
}
