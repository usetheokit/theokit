import { Plugin } from '@theokit/sdk'
import type { CustomTool } from '@theokit/sdk'

/**
 * The plugin SDK (OC-75): what a plugin's entry module default-exports. A plugin adds tools; the
 * agent calls them like any of its own. The SDK imports the entry only from a trusted plugin folder.
 */
export function defineTheoClawPlugin(spec: { readonly name: string; readonly version?: string; readonly tools: readonly CustomTool[] }): ReturnType<typeof Plugin.create> {
  return Plugin.create({
    kind: 'general',
    name: spec.name,
    version: spec.version ?? '0.0.0',
    register(ctx) {
      for (const tool of spec.tools) ctx.registerTool(tool)
    },
  })
}
