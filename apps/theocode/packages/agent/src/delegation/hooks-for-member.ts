import { createToolHooksPlugin } from '@theokit/agents'
import type { HookHandlers, ToolHooksPlugin } from '@theokit/agents'

export function hooksForMember(handlers: HookHandlers): ToolHooksPlugin | undefined {
  const preToolCall = handlers.pre_tool_call
  if (preToolCall === undefined) return undefined

  return createToolHooksPlugin({
    beforeToolCall: async (ctx) =>
      await preToolCall({
        ...ctx,
        agentId: 'squad-member',
        runId: '',
      }),
  })
}
