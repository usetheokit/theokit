import { join, sep } from 'node:path'

import { createPathVetoPlugin, vetoPathCall } from '@theokit/agents/tool-scope'
import type { ToolScope } from '@theokit/agents/tool-scope'
import type { Plugin } from '@theokit/sdk'

import type { ToolSettings } from './tool-settings.js'

/** The workspace directories the SDK and TheoClaw keep their state in. */
const STATE_DIRECTORIES = ['.theokit', '.theoclaw'] as const

/** The framework's refusal prefix, replaced by TheoClaw's own wording. */
const FRAMEWORK_PREFIX = 'path veto: '

/**
 * The veto reads only `projectRoot` and `protectedPaths`, so it takes those two, not a bound scope:
 * binding one here would count as a second binding of the sandbox the tools share.
 */
function scopeOf(settings: ToolSettings): ToolScope {
  return {
    projectRoot: settings.toolRoot,
    protectedPaths: STATE_DIRECTORIES.map((state) => join(settings.workspace, state)),
  } as unknown as ToolScope
}

/** TheoClaw's wording: the state directory is named, not the framework's absolute protected path. */
function reword(message: string): string {
  const text = message.startsWith(FRAMEWORK_PREFIX) ? message.slice(FRAMEWORK_PREFIX.length) : message
  const state = STATE_DIRECTORIES.find((name) => text.endsWith(`${sep}${name}`))
  const named = state === undefined ? text : text.replace(/ the protected path .*$/, ` the workspace's ${state} directory`)
  return `theoclaw: ${named}`
}

/**
 * The veto for one tool call made outside the SDK's dispatch: the refusal message, or `undefined`
 * when the call may run. A script's `api` call runs the tool's handler directly and skips the
 * `pre_tool_call` plugins, so `run_code`'s permission gate asks this instead (plan D3); the plugin
 * below asks the same framework check, so both give one verdict for one call.
 */
export function vetoToolCall(name: string, args: unknown, settings: ToolSettings): string | undefined {
  const message = vetoPathCall(scopeOf(settings), name, args)
  return message === undefined ? undefined : reword(message)
}

/**
 * The framework's path veto over the workspace's `.theokit` and `.theoclaw` (plan D2, FR-006),
 * under TheoClaw's plugin name and refusal wording.
 */
export function pathVetoPlugin(settings: ToolSettings): Plugin {
  const inner = createPathVetoPlugin(scopeOf(settings))
  if (inner.kind !== 'general') throw new Error('the framework path veto is a general plugin')
  return {
    ...inner,
    name: 'theoclaw-path-veto',
    register: (ctx) => {
      inner.register({
        ...ctx,
        on: (event: string, handler: (context: unknown) => unknown) =>
          ctx.on(event as 'pre_tool_call', (context: unknown) => {
            const verdict = handler(context) as { block: true; message: string } | undefined
            return verdict === undefined ? undefined : { block: true, message: reword(verdict.message) }
          }),
      } as typeof ctx)
    },
  }
}
