import type { PluginContext } from '@theokit/sdk'

import type { GeneralPlugin } from '../../src/tools/general-plugin.js'

export type HookFn = (context: unknown) => unknown

/** Registers a plugin against a stand-in host and returns the handler it attached to `hook` (these plugins register synchronously). */
export function handlerOf(plugin: GeneralPlugin, hook: Parameters<PluginContext['on']>[0] = 'pre_tool_call'): HookFn {
  let handler: HookFn | undefined
  const host: PluginContext = {
    registerTool: () => undefined,
    registerCommand: () => undefined,
    injectMessage: () => undefined,
    on: (name, fn) => {
      if (name === hook) handler = fn
      return () => undefined
    },
  }
  void plugin.register(host)
  if (handler === undefined) throw new Error(`the plugin attached no ${hook} handler`)
  return handler
}
