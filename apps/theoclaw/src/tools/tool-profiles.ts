import type { CustomTool } from '@theokit/sdk'
import { createSandboxBackend } from '@theokit/agents/sandbox'

import { TheoClawConfigError } from '../control-plane/errors.js'
import { buildTools, fileReadTools, readOnlyTools, shellToolFor } from './tool-registry.js'
import type { AgentToolOptions } from './tool-registry.js'
import { loopDetectionPlugin } from './loop-detection.js'
import { pathVetoPlugin } from './path-veto.js'
import { provenanceGuardPlugin } from './provenance-guard.js'
import type { ToolSettings } from './tool-settings.js'

/** The variable that gives an owner's direct chat a tool profile; unset, a chat agent holds no tool. */
export const TOOL_PROFILE_VARIABLE = 'THEOCLAW_TOOL_PROFILE'

/** minimal: read files; messaging: plus the web; coding: plus the sandboxed shell and file writers; full: plus the interactive shell. */
export const TOOL_PROFILES = ['minimal', 'messaging', 'coding', 'full'] as const
export type ToolProfile = (typeof TOOL_PROFILES)[number]

const SHELL_TOOL = 'shell_exec'

/** `THEOCLAW_TOOL_PROFILE`, or undefined when unset. Throws `TheoClawConfigError` on an unknown name. */
export function readToolProfile(env: Readonly<Record<string, string | undefined>>): ToolProfile | undefined {
  const value = env[TOOL_PROFILE_VARIABLE]?.trim().toLowerCase()
  if (value === undefined || value === '') return undefined
  const profile = TOOL_PROFILES.find((name) => name === value)
  if (profile === undefined) {
    throw new TheoClawConfigError(`${TOOL_PROFILE_VARIABLE} must be one of ${TOOL_PROFILES.join(', ')}`, { variable: TOOL_PROFILE_VARIABLE })
  }
  return profile
}

/**
 * The tools of a chat session under `profile`. With `elevated()` true at call time, `shell_exec`
 * runs outside the sandbox (`danger-full-access`); the setting is read per call, so `/elevated`
 * takes effect in a session whose agent is already open. `shell` is false when no exec gate exists
 * (no state directory), which leaves the shell out rather than run it unasked.
 */
export function profileToolOptions(profile: ToolProfile, settings: ToolSettings, elevated: () => boolean, shell: boolean): AgentToolOptions {
  const plugins = [pathVetoPlugin(settings), provenanceGuardPlugin(), loopDetectionPlugin()]
  if (profile === 'minimal') return { tools: fileReadTools(settings), plugins }
  if (profile === 'messaging') return { tools: readOnlyTools(settings), plugins }
  const { interactive, ...withoutInteractive } = settings
  const base = profile === 'full' || interactive === undefined ? settings : withoutInteractive
  const tools = buildTools({ ...base, hostTools: settings.hostTools && shell })
  return { tools: settings.hostTools && shell ? tools.map((tool) => (tool.name === SHELL_TOOL ? elevatable(tool, settings, elevated) : tool)) : tools, plugins }
}

/** `normal`, except that while `elevated()` holds the call goes to a shell on an unconfined backend. */
function elevatable(normal: CustomTool, settings: ToolSettings, elevated: () => boolean): CustomTool {
  let outside: CustomTool | undefined
  return {
    ...normal,
    handler: (input, ctx) => {
      if (!elevated()) return normal.handler(input, ctx)
      outside ??= shellToolFor({
        ...settings,
        sandbox: createSandboxBackend({ mode: 'danger-full-access', workDir: settings.toolRoot }),
        mode: 'danger-full-access',
        sandboxEnforced: false,
      })
      return outside.handler(input, ctx)
    },
  }
}
